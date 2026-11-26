// Sandbox time (spec 16a): awake intervals timed by the platform, one row per
// sandbox and interval. A case sandbox bills its size's price per second
// awake when an interval closes; an interval with no sleep or stop ends at its
// last heartbeat; builds and renders are recorded and never billed.

import { orgId, withOrg } from "@preprocess/db/client";
import { sandboxIntervals, usageRecords } from "@preprocess/db/schema/billing";
import type { SandboxEvent } from "@preprocess/sandbox";
import { asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import {
  closeSilentSandboxes,
  pricePerSecond,
  recordSandboxEvent,
  sandboxPrice,
} from "../src/sandbox.ts";
import { monthSpendParts } from "../src/spend.ts";
import { createOrganization, signUp, testEnv } from "./helpers.ts";

const environment = testEnv();
let org = "";

beforeAll(async () => {
  const owner = await signUp("Sandbox Owner", environment);
  org = await createOrganization(owner.client, "Sandboxco");
});

const at = (time: string) => new Date(`2026-11-26T${time}Z`);

const sandbox = (sandboxId: string, size = "medium") => {
  const send = (
    type: SandboxEvent["type"],
    seq: number,
    time: string,
    overrides: Partial<SandboxEvent> = {},
  ) =>
    recordSandboxEvent(
      environment,
      {
        sandboxId,
        seq,
        type,
        organizationId: org,
        agent: "agt_1",
        caseId: `case_${sandboxId}`,
        kind: "case",
        size,
        ...overrides,
      },
      at(time),
    );
  return send;
};

const recorded = (sandboxId: string) =>
  withOrg(environment, orgId(org), async (tx) => ({
    intervals: (
      await tx
        .select()
        .from(sandboxIntervals)
        .where(eq(sandboxIntervals.sandboxId, sandboxId))
        .orderBy(asc(sandboxIntervals.seq))
    ).map((i) => ({
      seq: i.seq,
      startedAt: i.startedAt.toISOString(),
      endedAt: i.endedAt?.toISOString() ?? null,
      endReason: i.endReason,
    })),
    charges: (
      await tx
        .select()
        .from(usageRecords)
        .where(eq(usageRecords.caseId, `case_${sandboxId}`))
    ).map((u) => [u.feature, u.quantity]),
  }));

describe("sandbox prices", () => {
  it("charge each size's Cloudflare cost with its CPU busy, times 1.5", () => {
    expect(pricePerSecond("small")).toBeCloseTo(30.84, 6);
    expect(pricePerSecond("medium")).toBeCloseTo(53.76, 6);
    expect(pricePerSecond("large")).toBeCloseTo(167.1, 6);
    expect(sandboxPrice("medium", 3600)).toBe(193_536);
  });
});

describe("sandbox intervals", () => {
  it("bill the seconds from start to sleep, and again from wake to sleep", async () => {
    const send = sandbox("sleeper");
    await send("start", 1, "10:00:00");
    await send("heartbeat", 1, "10:00:30");
    await send("sleep", 1, "10:01:00");
    await send("wake", 2, "10:30:00");
    await send("sleep", 2, "10:30:10");

    expect(await recorded("sleeper")).toEqual({
      intervals: [
        {
          seq: 1,
          startedAt: "2026-11-26T10:00:00.000Z",
          endedAt: "2026-11-26T10:01:00.000Z",
          endReason: "sleep",
        },
        {
          seq: 2,
          startedAt: "2026-11-26T10:30:00.000Z",
          endedAt: "2026-11-26T10:30:10.000Z",
          endReason: "sleep",
        },
      ],
      charges: [
        ["sandbox", sandboxPrice("medium", 60)],
        ["sandbox", sandboxPrice("medium", 10)],
      ],
    });
  });

  it("bill up to the destroy when the case closes, once however often it is reported", async () => {
    const send = sandbox("closer", "large");
    await send("start", 1, "11:00:00");
    await send("start", 1, "11:00:20");
    await send("destroy", 1, "11:02:00");
    await send("destroy", 1, "11:05:00");
    await send("sleep", 1, "11:06:00");

    expect(await recorded("closer")).toEqual({
      intervals: [
        {
          seq: 1,
          startedAt: "2026-11-26T11:00:00.000Z",
          endedAt: "2026-11-26T11:02:00.000Z",
          endReason: "destroy",
        },
      ],
      charges: [["sandbox", sandboxPrice("large", 120)]],
    });
  });

  it("end a crashed sandbox's interval at its last heartbeat", async () => {
    const send = sandbox("crasher", "small");
    await send("start", 1, "12:00:00");
    await send("heartbeat", 1, "12:00:30");
    await send("heartbeat", 1, "12:01:00");
    await send("crash", 1, "12:01:25");

    expect(await recorded("crasher")).toEqual({
      intervals: [
        {
          seq: 1,
          startedAt: "2026-11-26T12:00:00.000Z",
          endedAt: "2026-11-26T12:01:00.000Z",
          endReason: "crash",
        },
      ],
      charges: [["sandbox", sandboxPrice("small", 60)]],
    });
  });

  it("end an interval with no stop event at its last heartbeat once it goes silent", async () => {
    const send = sandbox("silent");
    await send("start", 1, "13:00:00");
    await send("heartbeat", 1, "13:00:30");

    await closeSilentSandboxes(environment, at("13:02:00"));
    expect((await recorded("silent")).intervals[0]!.endedAt).toBeNull();

    await closeSilentSandboxes(environment, at("13:02:31"));
    await send("heartbeat", 1, "13:03:00");
    await send("sleep", 1, "13:04:00");
    expect(await recorded("silent")).toEqual({
      intervals: [
        {
          seq: 1,
          startedAt: "2026-11-26T13:00:00.000Z",
          endedAt: "2026-11-26T13:00:30.000Z",
          endReason: "lost",
        },
      ],
      charges: [["sandbox", sandboxPrice("medium", 30)]],
    });
  });

  it("never bill an interval whose start was not recorded", async () => {
    const send = sandbox("headless");
    await send("heartbeat", 1, "14:00:30");
    await send("sleep", 1, "14:01:00");
    await send("crash", 2, "14:02:00");
    expect(await recorded("headless")).toEqual({ intervals: [], charges: [] });
  });

  it("record builds and renders without billing them", async () => {
    const send = sandbox("builder", "basic");
    await send("start", 1, "15:00:00", { kind: "build", caseId: undefined });
    await send("destroy", 1, "15:00:45", { kind: "build", caseId: undefined });
    const render = sandbox("renderer", "basic");
    await render("start", 1, "15:10:00", { kind: "render" });
    await render("destroy", 1, "15:16:00", { kind: "render" });

    expect((await recorded("builder")).intervals).toHaveLength(1);
    expect(await recorded("renderer")).toMatchObject({
      intervals: [{ endReason: "destroy" }],
      charges: [],
    });
  });

  it("ignore a case sandbox of an unknown size", async () => {
    const send = sandbox("odd", "standard-2");
    await send("start", 1, "16:00:00");
    expect((await recorded("odd")).intervals).toEqual([]);
  });

  it("count toward the month's spend", async () => {
    const spend = await withOrg(environment, orgId(org), (tx) =>
      monthSpendParts(tx, at("23:00:00")),
    );
    expect(spend.sandbox).toBe(
      sandboxPrice("medium", 60) +
        sandboxPrice("medium", 10) +
        sandboxPrice("large", 120) +
        sandboxPrice("small", 60) +
        sandboxPrice("medium", 30),
    );
  });

  it("record nothing on a self-hosted install", async () => {
    const { PREPROCESS_REGION: _cloud, ...selfHosted } = environment;
    await recordSandboxEvent(selfHosted, {
      sandboxId: "selfhosted",
      seq: 1,
      type: "start",
      organizationId: org,
      kind: "case",
      caseId: "case_selfhosted",
      size: "small",
    });
    expect((await recorded("selfhosted")).intervals).toEqual([]);
  });
});
