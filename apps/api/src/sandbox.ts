// Sandbox time (spec 16a), measured by our own platform, never by
// Cloudflare's analytics. Each sandbox's Durable Object reports start, wake,
// heartbeat, sleep, destroy and crash here, each timed by the Durable Object:
// a start when it asked the container to start, a stop when it saw the
// container stop, a crash nobody saw at the last check (every 5 seconds) that
// found the container running. An event without a usable time is stamped on
// arrival. An interval whose Durable Object goes silent (evicted with no stop
// event) ends at its last heartbeat.
// Customers pay only for case sandboxes, one price per second awake for the
// size they chose. Builds and PDF renders are recorded the same way and never
// billed. Only our cloud meters (spec 16).

import { audit } from "@preprocess/db/audit";
import { orgId, withOrg, withoutOrg } from "@preprocess/db/client";
import type { Tx } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { sandboxIntervals } from "@preprocess/db/schema/billing";
import { cases } from "@preprocess/db/schema/cases";
import { deployments } from "@preprocess/db/schema/deployments";
import { organizationGuardrails } from "@preprocess/db/schema/guardrails";
import { runMode } from "@preprocess/runmode";
import type { SandboxEvent } from "@preprocess/sandbox";
import { SANDBOX_SIZES } from "@preprocess/sdk/protocol";
import { and, eq, isNull, lt } from "drizzle-orm";

import { actor, eventBase } from "./caller.ts";
import type { OrgVariables } from "./caller.ts";
import type { Env } from "./env.ts";
import { trackEvent } from "./analytics.ts";
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

// How far an event's own time may sit from its arrival before the arrival
// time replaces it: a bad clock or a replayed event never moves billing far.
export const EVENT_SKEW_MS = { past: 10 * 60_000, future: 5_000 };

const eventTime = (event: SandboxEvent, now: Date) => {
  const at = event.at ? new Date(event.at) : null;
  if (!at || Number.isNaN(at.getTime())) return null;
  const offset = at.getTime() - now.getTime();
  return offset < -EVENT_SKEW_MS.past || offset > EVENT_SKEW_MS.future
    ? null
    : at;
};

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
  if (!open) return false;
  const endedAt = at === "lastSeen" ? open.lastSeenAt : at;
  await tx
    .update(sandboxIntervals)
    .set({ endedAt, endReason: reason })
    .where(eq(sandboxIntervals.id, open.id));
  if (open.kind !== "case" || !open.caseId) return true;
  const seconds =
    Math.max(0, endedAt.getTime() - open.startedAt.getTime()) / 1000;
  await meter(tx, env, {
    organizationId: open.organizationId,
    feature: "sandbox",
    quantity: sandboxPrice(open.size as CaseSandboxSize, seconds),
    caseId: open.caseId,
  });
  return true;
};

// The preset a case's sandbox runs, from its deployment's code.
const casePreset = async (
  tx: Tx,
  caseId: string | undefined,
): Promise<"standard" | "node" | "python" | "python_data" | "unknown"> => {
  if (!caseId) return "unknown" as const;
  const [row] = await tx
    .select({ manifest: deployments.manifest })
    .from(cases)
    .innerJoin(deployments, eq(deployments.id, cases.deploymentId))
    .where(eq(cases.id, caseId));
  const preset = (
    row?.manifest as { sandbox?: { preset?: string } } | undefined
  )?.sandbox?.preset;
  return preset === "python-data"
    ? ("python_data" as const)
    : preset === "standard" || preset === "node" || preset === "python"
      ? preset
      : ("unknown" as const);
};

export const recordSandboxEvent = async (
  env: Env,
  event: SandboxEvent,
  now = new Date(),
) => {
  if (runMode(env).kind !== "cloud" || !validSize(event)) return;
  const where = { sandboxId: event.sandboxId, seq: event.seq };
  const at = eventTime(event, now);
  const outcome = await withOrg(
    env,
    orgId(event.organizationId),
    async (tx) => {
      switch (event.type) {
        case "start":
        case "wake": {
          const [opened] = await tx
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
              startedAt: at ?? now,
              lastSeenAt: at ?? now,
            })
            .onConflictDoNothing()
            .returning({ id: sandboxIntervals.id });
          return opened && event.type === "start" && event.kind === "case"
            ? { started: await casePreset(tx, event.caseId) }
            : null;
        }
        case "heartbeat":
          await tx
            .update(sandboxIntervals)
            .set({ lastSeenAt: at ?? now })
            .where(
              and(
                eq(sandboxIntervals.sandboxId, event.sandboxId),
                eq(sandboxIntervals.seq, event.seq),
                isNull(sandboxIntervals.endedAt),
              ),
            );
          return null;
        case "sleep":
        case "destroy":
          await close(tx, env, where, at ?? now, event.type);
          return null;
        case "crash":
          return (await close(tx, env, where, at ?? "lastSeen", "crash"))
            ? { crashed: true }
            : null;
      }
      return null;
    },
  );
  if (event.kind !== "case" || !outcome) return;
  const ids = {
    case_id: event.caseId ?? null,
    size: event.size as CaseSandboxSize,
  };
  // A case's sandbox, the first time it starts, and one that crashed.
  if ("started" in outcome)
    await trackEvent(env, "sandbox_used", event.organizationId, null, {
      ...ids,
      preset: outcome.started,
    });
  else await trackEvent(env, "sandbox_failed", event.organizationId, null, ids);
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

// The largest case sandbox size an Owner or Admin allows (spec 5).
export const sizeRank = (size: CaseSandboxSize) => SANDBOX_SIZES.indexOf(size);

// Whether an organization whose largest allowed size is `cap` (null: every
// size) lets an agent use `size`.
export const sizeAllowed = (
  cap: CaseSandboxSize | null,
  size: CaseSandboxSize,
) => cap === null || sizeRank(size) <= sizeRank(cap);

// Runs in the organization's transaction.
export const sandboxMaxSize = async (tx: Tx): Promise<CaseSandboxSize | null> =>
  (
    await tx
      .select({ size: organizationGuardrails.sandboxMaxSize })
      .from(organizationGuardrails)
  )[0]?.size ?? null;

// An Owner or Admin's change is the approval (spec 5). Returns whether the cap
// changed, so callers resync the agents' deployments.
export const setSandboxMaxSize = async (
  tx: Tx,
  vars: OrgVariables,
  size: CaseSandboxSize | null,
) => {
  const before = await sandboxMaxSize(tx);
  if (before === size) return false;
  const updatedBy = actor(vars.caller).actorId;
  await tx
    .insert(organizationGuardrails)
    .values({ organizationId: vars.org, sandboxMaxSize: size, updatedBy })
    .onConflictDoUpdate({
      target: organizationGuardrails.organizationId,
      set: { sandboxMaxSize: size, updatedBy, updatedAt: new Date() },
    });
  await audit(tx, {
    ...eventBase(vars),
    action: "guardrail.updated",
    targetType: "organization",
    targetId: vars.org,
    data: { guardrail: "sandbox_size", before, after: size },
  });
  return true;
};
