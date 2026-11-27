// What auto-reload last ran into (PRE-128). Autumn's customer read carries
// neither a failed reload nor a reached monthly cap, so its
// billing.auto_topup_failed webhook, signed with Svix, records them per
// organization. A successful Retry, top-up or auto top-up, or the balance back
// at the threshold, clears a failure; the cap lapses on the 1st (UTC).

import { orgId, withOrg, type Tx } from "@preprocess/db/client";
import { organization } from "@preprocess/db/schema/auth";
import { autoReloadStates } from "@preprocess/db/schema/billing";
import { eq } from "drizzle-orm";

import { CREDITS } from "./billing.ts";
import type { Env } from "./env.ts";

// Svix's own default: a delivery older or newer than this is refused, so a
// captured request can't be replayed later.
const TOLERANCE_SECONDS = 5 * 60;

const base64 = (text: string) => {
  try {
    return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
};

// Svix signs "<svix-id>.<svix-timestamp>.<body>" with HMAC-SHA256, keyed by
// the base64 bytes after the secret's whsec_ prefix. svix-signature holds one
// or more space-separated "v1,<base64>" (several while a secret rotates).
export const verifySvix = async (
  secret: string,
  headers: Headers,
  body: string,
  now = Date.now(),
) => {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatures = headers.get("svix-signature");
  if (!id || !timestamp || !signatures) return false;
  const seconds = Number(timestamp);
  if (
    !Number.isInteger(seconds) ||
    Math.abs(now / 1000 - seconds) > TOLERANCE_SECONDS
  )
    return false;
  const raw = base64(secret.replace(/^whsec_/, ""));
  if (!raw?.length) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    raw,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signed = new TextEncoder().encode([id, timestamp, body].join("."));
  for (const entry of signatures.split(" ")) {
    const [version, value] = entry.split(",");
    const mac = version === "v1" && value ? base64(value) : null;
    if (mac && (await crypto.subtle.verify("HMAC", key, mac, signed)))
      return true;
  }
  return false;
};

export type AutumnEvent = {
  type: string;
  occurred_at?: number;
  data?: {
    customer_id?: string;
    feature_id?: string;
    reason?: string;
    error?: { code?: string | null; decline_code?: string | null } | null;
  };
};

// The card or its payment method stopped the charge: the Owner can Retry or
// update the card.
const CARD_FAILURES = new Set([
  "charge_failed",
  "missing_payment_method",
  "payment_method_not_supported",
  "payment_method_delayed",
  "failed_attempt_limit_reached",
  "suspended_after_failures",
]);

const nextMonthStart = (at: Date) =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));

const clearFailure = { failedAt: null, failedReason: null };

// Runs fn for one of our organizations, or logs and skips a customer that
// isn't one, so Autumn doesn't retry it.
const onOrganization = (
  env: Env,
  customer: string,
  fn: (tx: Tx) => Promise<unknown>,
) =>
  withOrg(env, orgId(customer), async (tx) => {
    const [known] = await tx
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, customer));
    if (known) await fn(tx);
    else
      console.log(
        JSON.stringify({ event: "autumn.webhook.unknown_customer", customer }),
      );
  });

// Records what a webhook says about an organization's credits auto-reload.
export const recordAutumnEvent = async (env: Env, event: AutumnEvent) => {
  const data = event.data;
  const org = data?.customer_id;
  if (!data || !org || data.feature_id !== CREDITS) return;
  if (event.type === "billing.auto_topup_succeeded") {
    await onOrganization(env, org, (tx) =>
      tx
        .update(autoReloadStates)
        .set({ ...clearFailure, capReachedUntil: null, updatedAt: new Date() })
        .where(eq(autoReloadStates.organizationId, org)),
    );
    return;
  }
  if (event.type !== "billing.auto_topup_failed") return;
  const at = new Date(event.occurred_at ?? Date.now());
  const reason = data.reason ?? "";
  const change = CARD_FAILURES.has(reason)
    ? {
        failedAt: at,
        failedReason:
          data.error?.code === "card_declined" || data.error?.decline_code
            ? "card_declined"
            : null,
      }
    : reason === "purchase_limit_reached"
      ? { capReachedUntil: nextMonthStart(at) }
      : null;
  if (!change) {
    console.log(
      JSON.stringify({
        event: "autumn.auto_topup_failed.ignored",
        customer: org,
        reason,
      }),
    );
    return;
  }
  await onOrganization(env, org, (tx) =>
    tx
      .insert(autoReloadStates)
      .values({ organizationId: org, ...change })
      .onConflictDoUpdate({
        target: autoReloadStates.organizationId,
        set: { ...change, updatedAt: new Date() },
      }),
  );
};

// A successful Retry or top-up resolves a failed reload.
export const clearReloadFailure = (env: Env, org: string) =>
  withOrg(env, orgId(org), (tx) =>
    tx
      .update(autoReloadStates)
      .set({ ...clearFailure, updatedAt: new Date() })
      .where(eq(autoReloadStates.organizationId, org)),
  );

export type ReloadState = {
  failed: { at: string; reason: "card_declined" | null } | null;
  capReachedUntil: string | null;
};

// The states GET /billing shows. A failure is resolved once the balance is
// back at the threshold; the cap holds only until the 1st it names.
export const readReloadState = (
  env: Env,
  org: string,
  recovered: boolean,
  now = new Date(),
): Promise<ReloadState> =>
  withOrg(env, orgId(org), async (tx) => {
    const [row] = await tx
      .select()
      .from(autoReloadStates)
      .where(eq(autoReloadStates.organizationId, org));
    if (row?.failedAt && recovered)
      await tx
        .update(autoReloadStates)
        .set({ ...clearFailure, updatedAt: new Date() })
        .where(eq(autoReloadStates.organizationId, org));
    return {
      failed:
        row?.failedAt && !recovered
          ? {
              at: row.failedAt.toISOString(),
              reason:
                row.failedReason === "card_declined" ? "card_declined" : null,
            }
          : null,
      capReachedUntil:
        row?.capReachedUntil && row.capReachedUntil > now
          ? row.capReachedUntil.toISOString()
          : null,
    };
  });
