import { DurableObject } from "cloudflare:workers";
import { createMiddleware } from "hono/factory";

import { isInternal } from "./billing.ts";
import type { OrgVariables } from "./caller.ts";
import type { Env } from "./env.ts";

// Per-organization rate limits (spec 15), counted in one-minute windows: every
// /v1 request in an organization, every request with one API key, and every
// sign-in attempt from one client address. Our own organizations
// (BILLING_INTERNAL_ORGS) are never limited.
export const LIMITS = { org: 2400, apiKey: 600, auth: 30 } as const;

const WINDOW_MS = 60_000;

// One object per organization holds its own count and each of its API keys';
// one per client address holds that address's sign-in attempts.
export const rateLimitName = {
  org: (org: string) => `${org}:rate`,
  auth: (ip: string) => `auth:rate:${ip}`,
};

type Bucket = { name: string; limit: number };

// The counts live in memory: an object evicted while idle has nothing left
// worth counting. A request is counted in every bucket or in none.
export class RateLimiter extends DurableObject<Env> {
  #window = 0;
  #counts = new Map<string, number>();

  take(buckets: Bucket[]): { allowed: boolean; retryAfter: number } {
    const now = Date.now();
    const window = Math.floor(now / WINDOW_MS);
    if (window !== this.#window) {
      this.#window = window;
      this.#counts.clear();
    }
    if (buckets.some((b) => (this.#counts.get(b.name) ?? 0) >= b.limit))
      return {
        allowed: false,
        retryAfter: Math.ceil(((window + 1) * WINDOW_MS - now) / 1000),
      };
    for (const b of buckets)
      this.#counts.set(b.name, (this.#counts.get(b.name) ?? 0) + 1);
    return { allowed: true, retryAfter: 0 };
  }
}

const take = (env: Env, name: string, buckets: Bucket[]) =>
  env.RATE_LIMITER.getByName(name).take(buckets);

const tooManyRequests = (retryAfter: number) =>
  Response.json(
    {
      error: "rate_limited",
      message: `Too many requests. Try again in ${retryAfter} seconds.`,
    },
    { status: 429, headers: { "retry-after": String(retryAfter) } },
  );

export const orgRateLimit = createMiddleware<{
  Bindings: Env;
  Variables: OrgVariables;
}>(async (c, next) => {
  const { org, caller } = c.var;
  if (isInternal(c.env, org)) return next();
  const result = await take(c.env, rateLimitName.org(org), [
    { name: "org", limit: LIMITS.org },
    ...(caller.type === "api_key"
      ? [{ name: `key:${caller.keyId}`, limit: LIMITS.apiKey }]
      : []),
  ]);
  if (!result.allowed) return tooManyRequests(result.retryAfter);
  await next();
});

// Better Auth routes that take a credential or send an email. Reading the
// session and polling for a device code's token are not counted.
const AUTH_ATTEMPT =
  /^\/api\/auth\/(sign-in|sign-up|magic-link|email-otp|forget-password|reset-password|send-verification-email|verify-email|device\/code)(\/|$)/;

// Only Cloudflare's edge sets cf-connecting-ip, so local development and
// tests without it are not limited.
export const authRateLimit = async (env: Env, request: Request) => {
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip || !AUTH_ATTEMPT.test(new URL(request.url).pathname)) return null;
  const result = await take(env, rateLimitName.auth(ip), [
    { name: "auth", limit: LIMITS.auth },
  ]);
  return result.allowed ? null : tooManyRequests(result.retryAfter);
};
