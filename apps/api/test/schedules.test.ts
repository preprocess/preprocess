// Schedules (design doc 04): declared in code, held by a scheduler Durable
// Object, fired once per due time even when the alarm retries, paused across
// deploys, refused by the spending limit without retrying, and run on a
// preview only when the schedule allows it.

import { orgId, withOrg, type OrgId } from "@preprocess/db/client";
import { cases } from "@preprocess/db/schema/cases";
import { and, eq } from "drizzle-orm";
import {
  env,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import type { Scheduler } from "../src/scheduler.ts";
import { schedulerName } from "../src/scheduler.ts";
import {
  addMember,
  Client,
  createOrganization,
  signUp,
  testEnv,
} from "./helpers.ts";
// Bundled by vitest.config.ts, as `preprocess deploy` bundles an agent.
import scheduledAgent from "./dist/scheduled-agent.js?raw";

type Schedule = {
  name: string;
  paused: boolean;
  nextRunAt: string | null;
  lastCaseId: string | null;
  lastError: string | null;
};

let org: OrgId;
let owner: Client;
let key: Client;
let agentId: string;

const call = <T>(
  client: Client,
  method: string,
  path: string,
  body?: unknown,
) =>
  client.call<T>(path.replace("{org}", org), {
    method,
    ...(body !== undefined && { body }),
  });

const deploy = (branch: string) =>
  call<{ id: string; agentId: string; status: string }>(
    key,
    "POST",
    "/v1/orgs/{org}/agents/reconciler/deployments",
    {
      bundle: {
        mainModule: "agent.js",
        modules: { "agent.js": scheduledAgent },
      },
      git: { branch },
    },
  );

const stub = (previewId?: string) =>
  env.SCHEDULER.getByName(schedulerName(org, agentId, previewId));

// Makes a schedule due by moving its next fire time into the past, then runs
// the alarm as the runtime would.
const fire = async (name: string, at: string, previewId?: string) => {
  const object = stub(previewId);
  await runInDurableObject(object, async (_: Scheduler, state) => {
    const runs =
      (await state.storage.get<Record<string, { next: string }>>("runs"))!;
    runs[name]!.next = at;
    await state.storage.put("runs", runs);
    await state.storage.setAlarm(Date.parse(at));
  });
  await runDurableObjectAlarm(object);
};

const scheduled = (name: string) =>
  withOrg(testEnv(), org, (tx) =>
    tx
      .select({ id: cases.id, deploymentId: cases.deploymentId })
      .from(cases)
      .where(and(eq(cases.source, "schedule"), eq(cases.createdBy, name))),
  );

const list = async () =>
  (
    await call<Schedule[]>(
      owner,
      "GET",
      "/v1/orgs/{org}/agents/reconciler/schedules",
    )
  ).body;

beforeAll(async () => {
  const signed = await signUp("Scheduler");
  owner = signed.client;
  org = orgId(await createOrganization(owner, "Schedco"));
  const created = await owner.call<{ key: string }>(
    "/api/auth/api-key/create",
    {
      body: { name: "deploy", organizationId: org },
    },
  );
  key = new Client(testEnv(), { authorization: `Bearer ${created.body.key}` });
  const deployed = await deploy("main");
  expect(deployed.status).toBe(201);
  agentId = deployed.body.agentId;
});

describe("schedules", () => {
  it("are listed from the production deployment with their next run", async () => {
    const schedules = await list();
    expect(schedules.map((s) => s.name)).toEqual([
      "nightly-reconcile",
      "hourly-check",
    ]);
    const nightly = schedules[0]!;
    expect(nightly.paused).toBe(false);
    // 02:00 in New York is 07:00 UTC outside daylight saving time.
    expect(new Date(nightly.nextRunAt!).getUTCMinutes()).toBe(0);
    expect([6, 7]).toContain(new Date(nightly.nextRunAt!).getUTCHours());
  });

  it("create one case per due time, even when the alarm runs twice", async () => {
    const at = "2026-11-20T07:00:00.000Z";
    await fire("nightly-reconcile", at);
    await fire("nightly-reconcile", at);
    const made = await scheduled("nightly-reconcile");
    expect(made).toHaveLength(1);
    const nightly = (await list()).find((s) => s.name === "nightly-reconcile")!;
    expect(nightly.lastCaseId).toBe(made[0]!.id);
    expect(Date.parse(nightly.nextRunAt!)).toBeGreaterThan(Date.now());
  });

  it("stay paused across a deploy until resumed, and audit both", async () => {
    const member = await addMember(owner, org, "Max");
    expect(
      (
        await call(
          member.client,
          "POST",
          "/v1/orgs/{org}/agents/reconciler/schedules/hourly-check/pause",
        )
      ).status,
    ).toBe(404);
    const paused = await call<Schedule>(
      owner,
      "POST",
      "/v1/orgs/{org}/agents/reconciler/schedules/hourly-check/pause",
    );
    expect(paused.body).toMatchObject({ paused: true, nextRunAt: null });

    expect((await deploy("main")).status).toBe(201);
    await fire("hourly-check", "2026-11-20T08:00:00.000Z");
    expect(await scheduled("hourly-check")).toHaveLength(0);
    expect((await list()).find((s) => s.name === "hourly-check")?.paused).toBe(
      true,
    );

    const resumed = await call<Schedule>(
      owner,
      "POST",
      "/v1/orgs/{org}/agents/reconciler/schedules/hourly-check/resume",
    );
    expect(resumed.body.paused).toBe(false);
    expect(resumed.body.nextRunAt).not.toBeNull();
    const audit = await call<{ events: { action: string }[] }>(
      owner,
      "GET",
      "/v1/orgs/{org}/audit-events?targetType=agent",
    );
    const actions = audit.body.events.map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining(["schedule.paused", "schedule.resumed"]),
    );
  });

  it("record a fire the spending limit refuses, without retrying it", async () => {
    await call(owner, "PUT", "/v1/orgs/{org}/spending/limit", { limitUsd: 0 });
    await fire("nightly-reconcile", "2026-11-21T07:00:00.000Z");
    const nightly = (await list()).find((s) => s.name === "nightly-reconcile")!;
    expect(nightly.lastError).toBe("spending_limit_reached");
    expect(await scheduled("nightly-reconcile")).toHaveLength(1);
    await call(owner, "PUT", "/v1/orgs/{org}/spending/limit", {
      limitUsd: null,
    });
  });

  it("run on a preview only when the schedule allows it", async () => {
    const preview = await deploy("feature-x");
    expect(preview.status).toBe(201);
    const previewId = preview.body.id;
    await fire("nightly-reconcile", "2026-11-22T07:00:00.000Z", previewId);
    await fire("hourly-check", "2026-11-22T08:00:00.000Z", previewId);
    expect(
      (await scheduled("nightly-reconcile")).filter(
        (c) => c.deploymentId === previewId,
      ),
    ).toHaveLength(0);
    expect(
      (await scheduled("hourly-check")).filter(
        (c) => c.deploymentId === previewId,
      ),
    ).toHaveLength(1);
  });
});
