// Sandbox time (spec 16a), measured by our own platform, never by
// Cloudflare's analytics. Each sandbox's Durable Object reports start, wake,
// heartbeat, sleep, destroy and crash here, and this API stamps the time. An
// interval runs from start or wake to sleep or destroy; one that ends any
// other way (a crash, or its Durable Object evicted) ends at its last
// heartbeat, so a missed event can only under-bill, by at most one heartbeat.
// Customers pay only for case sandboxes, one price per second awake for the
// size they chose. Builds and PDF renders are recorded the same way and never
// billed. Only our cloud meters (spec 16).

import { orgId, withOrg, withoutOrg } from "@preprocess/db/client";
import type { Tx } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { sandboxIntervals } from "@preprocess/db/schema/billing";
import { runMode } from "@preprocess/runmode";
import type { SandboxEvent } from "@preprocess/sandbox";
import { and, eq, isNull, lt } from "drizzle-orm";

import type { Env } from "./env.ts";
import { meter } from "./metering.ts";

// Cloudflare's instance types (developers.cloudflare.com/containers/platform/limits).
export const sandboxSizes = {
  lite: { vcpu: 1 / 16, memoryGib: 0.25, diskGb: 2 },
  basic: { vcpu: 1 / 4, memoryGib: 1, diskGb: 4 },
  "standard-1": { vcpu: 1 / 2, memoryGib: 4, diskGb: 8 },
  "standard-2": { vcpu: 1, memoryGib: 6, diskGb: 12 },
  "standard-3": { vcpu: 2, memoryGib: 8, diskGb: 16 },
  "standard-4": { vcpu: 4, memoryGib: 12, diskGb: 20 },
} as const;
export type SandboxSize = keyof typeof sandboxSizes;

// The sizes a case sandbox offers, by id, and the instance type each runs on.
export const caseSandboxSizes = {
  small: "standard-1",
  medium: "standard-2",
  large: "standard-4",
} as const satisfies Record<string, SandboxSize>;
export type CaseSandboxSize = keyof typeof caseSandboxSizes;

// What Cloudflare charges us, in USD (developers.cloudflare.com/containers/
// platform/pricing): memory and disk as provisioned while awake, CPU as used.
export const cloudflareRates = {
  memoryGibSecond: 0.0000025,
  diskGbSecond: 0.00000007,
  vcpuSecond: 0.00002,
};

// Our price over Cloudflare's cost (Chip, 2026-11-26).
export const SANDBOX_PRICE_MULTIPLIER = 1.5;

const MICRO_USD = 1e6;

// A case sandbox's price per second awake, in micro-USD: Cloudflare's cost for
// its instance type with every vCPU busy, times the multiplier.
export const pricePerSecond = (size: CaseSandboxSize) => {
  const { vcpu, memoryGib, diskGb } = sandboxSizes[caseSandboxSizes[size]];
  const usd =
    memoryGib * cloudflareRates.memoryGibSecond +
    diskGb * cloudflareRates.diskGbSecond +
    vcpu * cloudflareRates.vcpuSecond;
  return usd * SANDBOX_PRICE_MULTIPLIER * MICRO_USD;
};

// What a case sandbox of this size awake this long costs, in micro-USD.
export const sandboxPrice = (size: CaseSandboxSize, seconds: number) =>
  Math.round(seconds * pricePerSecond(size));

// How long a sandbox can go without a heartbeat (every 30 seconds) before its
// open interval is closed at the last one.
export const SILENCE_MS = 2 * 60_000;

const validSize = (event: SandboxEvent) =>
  event.kind === "case"
    ? event.size in caseSandboxSizes
    : event.size in sandboxSizes;

// Ends an open interval at `at` and bills it if it is a case sandbox's. The
// update matches only an open interval, so an interval is billed once, and
// never when its start was not recorded.
const close = async (
  tx: Tx,
  env: Pick<Env, "PREPROCESS_REGION">,
  where: { sandboxId: string; seq: number },
  at: Date | "lastSeen",
  reason: "sleep" | "destroy" | "crash" | "lost",
) => {
  const [open] = await tx
    .select()
    .from(sandboxIntervals)
    .where(
      and(
        eq(sandboxIntervals.sandboxId, where.sandboxId),
        eq(sandboxIntervals.seq, where.seq),
        isNull(sandboxIntervals.endedAt),
      ),
    )
    .for("update");
  if (!open) return;
  const endedAt = at === "lastSeen" ? open.lastSeenAt : at;
  await tx
    .update(sandboxIntervals)
    .set({ endedAt, endReason: reason })
    .where(eq(sandboxIntervals.id, open.id));
  if (open.kind !== "case" || !open.caseId) return;
  const seconds =
    Math.max(0, endedAt.getTime() - open.startedAt.getTime()) / 1000;
  await meter(tx, env, {
    organizationId: open.organizationId,
    feature: "sandbox",
    quantity: sandboxPrice(open.size as CaseSandboxSize, seconds),
    caseId: open.caseId,
  });
};

export const recordSandboxEvent = async (
  env: Env,
  event: SandboxEvent,
  now = new Date(),
) => {
  if (runMode(env).kind !== "cloud" || !validSize(event)) return;
  const where = { sandboxId: event.sandboxId, seq: event.seq };
  await withOrg(env, orgId(event.organizationId), async (tx) => {
    switch (event.type) {
      case "start":
      case "wake":
        await tx
          .insert(sandboxIntervals)
          .values({
            id: newId("sandboxInterval"),
            organizationId: event.organizationId,
            sandboxId: event.sandboxId,
            seq: event.seq,
            agent: event.agent ?? null,
            caseId: event.caseId ?? null,
            kind: event.kind,
            size: event.size,
            startedAt: now,
            lastSeenAt: now,
          })
          .onConflictDoNothing();
        return;
      case "heartbeat":
        await tx
          .update(sandboxIntervals)
          .set({ lastSeenAt: now })
          .where(
            and(
              eq(sandboxIntervals.sandboxId, event.sandboxId),
              eq(sandboxIntervals.seq, event.seq),
              isNull(sandboxIntervals.endedAt),
            ),
          );
        return;
      case "sleep":
      case "destroy":
        await close(tx, env, where, now, event.type);
        return;
      case "crash":
        await close(tx, env, where, "lastSeen", "crash");
    }
  });
};

// Every minute: intervals whose sandbox went silent end at their last
// heartbeat.
export const closeSilentSandboxes = async (env: Env, now = new Date()) => {
  if (runMode(env).kind !== "cloud") return;
  const silent = await withoutOrg(env, "sandboxes: silent intervals", (tx) =>
    tx
      .select({
        organizationId: sandboxIntervals.organizationId,
        sandboxId: sandboxIntervals.sandboxId,
        seq: sandboxIntervals.seq,
      })
      .from(sandboxIntervals)
      .where(
        and(
          isNull(sandboxIntervals.endedAt),
          lt(sandboxIntervals.lastSeenAt, new Date(now.getTime() - SILENCE_MS)),
        ),
      ),
  );
  for (const interval of silent)
    await withOrg(env, orgId(interval.organizationId), (tx) =>
      close(tx, env, interval, "lastSeen", "lost"),
    ).catch((error: unknown) =>
      console.error("sandboxes: close silent", interval.sandboxId, error),
    );
};
