// Evals on each new deployment (design doc 09): with evals.onPush on, a
// production deployment that becomes ready (at deploy, after a grant frees
// it, or once its custom environment is built) runs the agent's suites marked
// runOnPush, once per deployment and suite, started by the platform on the
// deployment's model. Previews never start them, and the spending limit
// skips them.

import { orgId, withOrg, type OrgId } from "@preprocess/db/client";
import { auditEvents } from "@preprocess/db/schema/audit";
import { deployments } from "@preprocess/db/schema/deployments";
import { evalRuns } from "@preprocess/db/schema/evals";
import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { syncDeployment } from "../src/deploy.ts";
import type { Env, Runtime } from "../src/env.ts";
import { layerBuilt } from "../src/sandbox-layers.ts";
import type { Client } from "./helpers.ts";
import { createOrganization, signUp, testEnv } from "./helpers.ts";
// Bundled by vitest.config.ts, as `preprocess deploy` bundles an agent.
import sampleAgent from "./dist/sample-agent.js?raw";
import setupAgent from "./dist/setup-agent.js?raw";

const real = (env as unknown as { RUNTIME: Runtime }).RUNTIME;
const runtime = new Proxy(real, {
  get: (target, name: keyof Runtime) => {
    if (name === "queueSandboxLayer") return () => Promise.resolve();
    return (...args: unknown[]) =>
      (target[name] as (...a: unknown[]) => unknown)(...args);
  },
});

const environment: Env = testEnv({
  AUTUMN_SECRET_KEY: "am_sk_test_stub",
  RUNTIME: runtime,
});

// The billing service grants custom sandbox environments.
const stubPlan = () =>
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "api.useautumn.com")
      throw new Error(`unexpected fetch to ${url.hostname}`);
    const body = JSON.parse(
      typeof init?.body === "string" ? init.body : "{}",
    ) as Record<string, unknown>;
    const route = url.pathname.replace("/v1/", "");
    return Promise.resolve(
      Response.json(
        route === "customers.get_or_create"
          ? {
              id: body.customer_id,
              subscriptions: [{ plan_id: "team", status: "active" }],
              flags: { custom_sandbox_images: {} },
              balances: {},
            }
          : route === "check"
            ? { allowed: true }
            : {},
      ),
    );
  });

afterEach(() => {
  vi.restoreAllMocks();
});

type Deployment = { id: string; agentId: string; status: string };

let owner: Client;
let org: OrgId;

const deploy = async (agent: string, source: string, branch = "main") => {
  const res = await owner.call<Deployment>(
    `/v1/orgs/${org}/agents/${agent}/deployments`,
    {
      method: "POST",
      body: {
        bundle: { mainModule: "agent.js", modules: { "agent.js": source } },
        git: { branch },
      },
    },
  );
  expect(res.status).toBe(201);
  return res.body;
};

const pushSuite = async (agent: string) => {
  const res = await owner.call<{ id: string; runOnPush: boolean }>(
    `/v1/orgs/${org}/agents/${agent}/eval-suites`,
    { body: { name: `${agent} on push`, runOnPush: true } },
  );
  expect(res.status).toBe(201);
  expect(res.body.runOnPush).toBe(true);
  return res.body.id;
};

const pushRuns = (deploymentId: string) =>
  withOrg(environment, org, (tx) =>
    tx
      .select()
      .from(evalRuns)
      .where(
        and(
          eq(evalRuns.deploymentId, deploymentId),
          eq(evalRuns.trigger, "push"),
        ),
      ),
  );

const status = async (id: string) =>
  (
    await withOrg(environment, org, (tx) =>
      tx
        .select({ status: deployments.status })
        .from(deployments)
        .where(eq(deployments.id, id)),
    )
  )[0]!.status;

const eventually = async (check: () => Promise<boolean>) => {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("timed out waiting");
};

let stockSuite: string;
let first: Deployment;

beforeAll(async () => {
  owner = (await signUp("Pusher", environment)).client;
  org = orgId(await createOrganization(owner, "Pushco"));
});

describe("evals on each new deployment", () => {
  it("accepts evals.onPush as a default and an override, and runOnPush on suites", async () => {
    const defaults = await owner.call(`/v1/orgs/${org}/defaults`, {
      method: "PATCH",
      body: { "evals.onPush": true },
    });
    expect(defaults.status).toBe(200);
    expect(defaults.body).toMatchObject({ "evals.onPush": true });
    first = await deploy("stock", sampleAgent);
    expect(first.status).toBe("waiting");
    const override = await owner.call(
      `/v1/orgs/${org}/agents/stock/settings/evals.onPush`,
      { method: "PUT", body: { value: true } },
    );
    expect(override.status).toBeLessThan(300);
    stockSuite = await pushSuite("stock");
    expect(await pushRuns(first.id)).toEqual([]);
  });

  it("runs once a grant frees a waiting deployment, started by the platform", async () => {
    await owner.call(`/v1/orgs/${org}/secrets/ERP_TOKEN`, {
      method: "PUT",
      body: { value: "erp-live-7c1f9a" },
    });
    await owner.call(`/v1/orgs/${org}/secrets/ERP_TOKEN/agents/stock`, {
      method: "PUT",
    });
    await eventually(async () => (await status(first.id)) === "ready");
    const runs = await pushRuns(first.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      suiteId: stockSuite,
      trigger: "push",
      createdBy: "platform",
    });
    const [event] = await withOrg(environment, org, (tx) =>
      tx
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.action, "eval_run.started"),
            eq(auditEvents.targetId, stockSuite),
          ),
        ),
    );
    expect(event).toMatchObject({
      actorType: "platform",
      actorId: `deployment:${first.id}`,
    });
  });

  it("never runs a suite twice against one deployment", async () => {
    await withOrg(environment, org, async (tx) => {
      await tx
        .update(deployments)
        .set({ status: "waiting" })
        .where(eq(deployments.id, first.id));
      await syncDeployment(tx, org, first.id);
      await syncDeployment(tx, org, first.id);
    });
    expect(await status(first.id)).toBe("ready");
    expect(await pushRuns(first.id)).toHaveLength(1);
  });

  it("runs on a deployment that is ready at deploy, and not on a preview", async () => {
    const second = await deploy("stock", sampleAgent);
    expect(second.status).toBe("ready");
    expect(await pushRuns(second.id)).toHaveLength(1);
    const preview = await deploy("stock", sampleAgent, "feature");
    expect(preview.status).toBe("ready");
    expect(await pushRuns(preview.id)).toEqual([]);
  });

  it("runs once a custom environment is built", async () => {
    stubPlan();
    const building = await deploy("parser", setupAgent);
    expect(building.status).toBe("building");
    const suite = await pushSuite("parser");
    expect(
      await layerBuilt(environment, {
        deployment: {
          organizationId: org,
          agentId: building.agentId,
          deploymentId: building.id,
        },
        result: {
          key: `org/${org}/layers/${"a".repeat(64)}`,
          image: "registry.example/sandbox-python@sha256:1",
          bytes: 50_000_000,
          unpackedBytes: 150_000_000,
        },
      }),
    ).toEqual({ ok: true });
    const runs = await pushRuns(building.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.suiteId).toBe(suite);
  });

  it("skips the runs while the organization is at its spending limit", async () => {
    const limit = await owner.call(`/v1/orgs/${org}/spending/limit`, {
      method: "PUT",
      body: { limitUsd: 0 },
    });
    expect(limit.status).toBe(200);
    const third = await deploy("stock", sampleAgent);
    expect(third.status).toBe("ready");
    expect(await pushRuns(third.id)).toEqual([]);
    const skipped = await withOrg(environment, org, (tx) =>
      tx
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.action, "eval_run.skipped"),
            eq(auditEvents.targetId, third.id),
          ),
        ),
    );
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.data).toMatchObject({
      reason: "spending_limit_reached",
      suites: [stockSuite],
    });
  });
});
