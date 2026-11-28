import { DurableObject } from "cloudflare:workers";
import { createMiddleware } from "hono/factory";

import { trackEvent } from "./analytics.ts";
import { isInternal } from "./billing.ts";
import type { OrgVariables } from "./caller.ts";
import type { Env } from "./env.ts";

// Per-organization rate limits (spec 15), counted in one-minute windows: every
// /v1 request in an organization, every request with one API key, and every
// sign-in attempt from one client address. Our own organizations
// (BILLING_INTERNAL_ORGS) are never limited.
export const LIMITS = {
  org: 2400,
  apiKey: 600,
  auth: 30,
} as const;

const WINDOW_MS = 60_000;

// One object per organization holds its own count and each of its API keys';
// one per client address holds that address's sign-in attempts.
export const rateLimitName = {
  org: (org: string) => `${org}:rate`,
  auth: (ip: string) => `auth:rate:${ip}`,
};

type Bucket = { name: string; limit: number };

// The counts live in memory: an object evicted while idle has nothing left
// worth counting. A request is counted in every bucket or in none, and the
// answer names the buckets that are full.
export class RateLimiter extends DurableObject<Env> {
  #window = 0;
  #counts = new Map<string, number>();

  take(buckets: Bucket[]): { over: string[]; retryAfter: number } {
    const now = Date.now();
    const window = Math.floor(now / WINDOW_MS);
    if (window !== this.#window) {
      this.#window = window;
      this.#counts.clear();
    }
    const over = buckets
      .filter((b) => (this.#counts.get(b.name) ?? 0) >= b.limit)
      .map((b) => b.name);
    if (over.length)
      return {
        over,
        retryAfter: Math.ceil(((window + 1) * WINDOW_MS - now) / 1000),
      };
    for (const b of buckets)
      this.#counts.set(b.name, (this.#counts.get(b.name) ?? 0) + 1);
    return { over, retryAfter: 0 };
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

// One rate_limited event (analytics.ts) per full bucket and window in each
// isolate: a client retrying past its limit would otherwise send one a
// request. The keys stay in memory, never in the event.
const reported = new Map<string, number>();
const reportLimited = (
  env: Env,
  waitUntil: (promise: Promise<unknown>) => void,
  bucket: string,
  scope: "org" | "api_key" | "sign_in",
  organizationId: string | null = null,
  actor: string | null = null,
) => {
  const window = Math.floor(Date.now() / WINDOW_MS);
  if (reported.get(bucket) === window) return;
  if (reported.size >= 10_000) reported.clear();
  reported.set(bucket, window);
  waitUntil(trackEvent(env, "rate_limited", organizationId, actor, { scope }));
};

// Organization and API key buckets this isolate has been told are full, and
// until when.
const full = new Map<string, number>();

// The Durable Object is asked after the response, off the request's path (a
// round trip on every /v1 request costs about 25 ms at p50): a request is
// refused once its isolate has heard that its organization or key is full.
// So each isolate may let through about one request too many per window.
export const orgRateLimit = createMiddleware<{
  Bindings: Env;
  Variables: OrgVariables;
}>(async (c, next) => {
  const { org, caller } = c.var;
  if (isInternal(c.env, org)) return next();
  const buckets = [
    { name: "org", limit: LIMITS.org },
    ...(caller.type === "api_key"
      ? [{ name: `key:${caller.keyId}`, limit: LIMITS.apiKey }]
      : []),
  ];
  const now = Date.now();
  const until = Math.max(
    0,
    ...buckets.map((b) => full.get(`${org}:${b.name}`) ?? 0),
  );
  if (until > now) {
    for (const b of buckets)
      if ((full.get(`${org}:${b.name}`) ?? 0) > now)
        reportLimited(
          c.env,
          (p) => c.executionCtx.waitUntil(p),
          `${org}:${b.name}`,
          b.name === "org" ? "org" : "api_key",
          org,
          caller.type === "person" ? caller.userId : null,
        );
    return tooManyRequests(Math.ceil((until - now) / 1000));
  }
  for (const b of buckets) full.delete(`${org}:${b.name}`);
  c.executionCtx.waitUntil(
    take(c.env, rateLimitName.org(org), buckets).then(
      ({ over, retryAfter }) => {
        for (const name of over)
          full.set(`${org}:${name}`, Date.now() + retryAfter * 1000);
      },
    ),
  );
  await next();
});

// Better Auth routes that take a credential or send an email. Reading the
// session and polling for a device code's token are not counted.
const AUTH_ATTEMPT =
  /^\/api\/auth\/(sign-in|sign-up|magic-link|email-otp|forget-password|reset-password|send-verification-email|verify-email|device\/code)(\/|$)/;

// Only Cloudflare's edge sets cf-connecting-ip, so local development and
// tests without it are not limited.
export const authRateLimit = async (
  env: Env,
  request: Request,
  waitUntil: (promise: Promise<unknown>) => void,
) => {
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip || !AUTH_ATTEMPT.test(new URL(request.url).pathname)) return null;
  const result = await take(env, rateLimitName.auth(ip), [
    { name: "auth", limit: LIMITS.auth },
  ]);
  if (!result.over.length) return null;
  reportLimited(env, waitUntil, `auth:${ip}`, "sign_in");
  return tooManyRequests(result.retryAfter);
};
