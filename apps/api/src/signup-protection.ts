import { APIError } from "better-auth/api";

import { trackEvent } from "./analytics.ts";
import { DISPOSABLE_DOMAINS } from "./disposable-domains.ts";
import type { Env } from "./env.ts";

// Sign-up protection (PRE-165) for the one route that mails a sign-in link,
// /sign-in/magic-link, which also creates the account when a new address
// opens it: a Turnstile check, no temporary inboxes for new addresses, and
// a cap on links per address. Google, SSO and directory sign-ups never pass
// through it, and the CLI signs in by device code, approved in the app.

// The browser sends the widget's token in this header.
export const TURNSTILE_HEADER = "x-turnstile-token";
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// Without a secret (local development, previews, self-hosted installs that
// set no keys) there is no check.
export const turnstilePassed = async (
  env: Env,
  token: string | null | undefined,
  ip: string | null,
) => {
  if (!env.SIGN_IN_TURNSTILE_SECRET) return true;
  if (!token) return false;
  const form = new FormData();
  form.set("secret", env.SIGN_IN_TURNSTILE_SECRET);
  form.set("response", token);
  if (ip) form.set("remoteip", ip);
  try {
    const response = await fetch(SITEVERIFY, { method: "POST", body: form });
    if (!response.ok) return false;
    return (await response.json<{ success?: boolean }>()).success === true;
  } catch {
    return false;
  }
};

const disposable = new Set(DISPOSABLE_DOMAINS.split("\n").filter(Boolean));

// Domains the vendored list blocks that people really use. Add one with the
// reason beside it.
export const ALLOWED_DOMAINS: ReadonlySet<string> = new Set<string>();

// The address's domain or any domain above it, so a subdomain of a listed
// service is blocked too.
const domainsOf = (email: string) => {
  const labels = email
    .slice(email.lastIndexOf("@") + 1)
    .toLowerCase()
    .split(".");
  return labels.slice(0, -1).map((_, i) => labels.slice(i).join("."));
};

export const isDisposable = (
  email: string,
  allowed: ReadonlySet<string> = ALLOWED_DOMAINS,
) => {
  const domains = domainsOf(email);
  return (
    !domains.some((domain) => allowed.has(domain)) &&
    domains.some((domain) => disposable.has(domain))
  );
};

// Sign-in links one address may be sent an hour. Plus-addresses count as
// their mailbox, so a+1@ and a+2@ share one count.
export const SIGN_IN_LINKS_PER_HOUR = 5;

const mailbox = (email: string) => {
  const at = email.lastIndexOf("@");
  const local = email.slice(0, at).split("+")[0];
  return `${local}@${email.slice(at + 1)}`.toLowerCase();
};

// The address is hashed so the object's name never holds it.
export const takeSignInLink = async (env: Env, email: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(mailbox(email)),
  );
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const { over } = await env.RATE_LIMITER.getByName(
    `auth:email:${hash}`,
  ).takeHourly(SIGN_IN_LINKS_PER_HOUR);
  return !over;
};

export type BlockReason = "bot" | "disposable" | "rate_limited";

const REFUSALS = {
  bot: [
    "FORBIDDEN",
    "BOT_CHECK_FAILED",
    "We couldn't confirm you're a person. Complete the check and try again.",
  ],
  disposable: [
    "FORBIDDEN",
    "DISPOSABLE_EMAIL",
    "Use a permanent email address. Temporary email addresses aren't supported.",
  ],
  rate_limited: [
    "TOO_MANY_REQUESTS",
    "TOO_MANY_LINKS",
    "Too many sign-in links for this address. Try again later.",
  ],
} as const;

// The signup_blocked event, with neither the address nor its domain, and
// the refusal to throw. A failed send never lets the request through.
export const signupBlocked = async (env: Env, reason: BlockReason) => {
  await trackEvent(env, "signup_blocked", null, null, { cause: reason }).catch(
    () => undefined,
  );
  const [status, code, message] = REFUSALS[reason];
  return new APIError(status, { code, message });
};
