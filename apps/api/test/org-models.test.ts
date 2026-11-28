// Organization models (design doc 10, "Using org models"): an org:<slug>
// model the organization registered is accepted wherever a model is chosen
// (deploys, settings, organization defaults, eval runs and the allowed-models
// guardrail), runs through its endpoint, and can't be deleted while anything
// still names it. Another organization can't name it.

import { orgId, withOrg, type OrgId } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { usageRecords } from "@preprocess/db/schema/billing";
import { evalRuns } from "@preprocess/db/schema/evals";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { Client, createOrganization, signUp, testEnv } from "./helpers.ts";
// Bundled by vitest.config.ts, as `preprocess deploy` bundles an agent.
import networkAgent from "./dist/network-agent.js?raw";
import orgModelAgent from "./dist/org-model-agent.js?raw";

type Failure = { error: { code: string; message: string } };
type Who = { org: OrgId; owner: Client; key: Client };

const MODEL = "org:invoices-v2";

const seedOrg = async (name: string): Promise<Who> => {
  const owner = (await signUp(name)).client;
  const org = orgId(await createOrganization(owner, name));
  const created = await owner.call<{ key: string }>(
    "/api/auth/api-key/create",
    { body: { name: "deploy", organizationId: org } },
  );
  const key = new Client(testEnv(), {
    authorization: `Bearer ${created.body.key}`,
  });
  return { org, owner, key };
};

const call = <T = unknown>(
  who: Who,
  path: string,
  init: { method?: string; body?: unknown } = {},
) => who.key.call<T & Partial<Failure>>(`/v1/orgs/${who.org}${path}`, init);

const deploy = (who: Who, slug: string, code: string) =>
  call<{ id: string; status: string }>(who, `/agents/${slug}/deployments`, {
    body: {
      bundle: { mainModule: "agent.js", modules: { "agent.js": code } },
      git: { branch: "main" },
    },
  });

const setModel = (who: Who, value: string | null) =>
  call(who, "/agents/network-agent/settings/model", {
    method: value === null ? "DELETE" : "PUT",
    ...(value !== null && { body: { value } }),
  });

let a: Who;
let b: Who;
let endpointId: string;
let deploymentId: string;
let suiteId: string;
let invoicesDeployment: string;

beforeAll(async () => {
  a = await seedOrg("Orgmodelco");
  b = await seedOrg("Othermodelco");
  // The runtime's internet serves model-stub.test from the stub.
  const registered = await call<{ id: string }>(a, "/models/endpoints", {
    body: {
      model: MODEL,
      label: "Invoices v2",
      baseModel: "kimi-k3.1-pro",
      url: "https://model-stub.test",
      providerModel: "deepseek-ai/DeepSeek-V4.1-Flash-1017",
      key: "test",
    },
  });
  expect(registered.status).toBe(201);
  endpointId = registered.body.id;
  const deployed = await deploy(a, "network-agent", networkAgent);
  expect(deployed.body.status).toBe("ready");
  deploymentId = deployed.body.id;
  expect((await deploy(b, "network-agent", networkAgent)).body.status).toBe(
    "ready",
  );
});

describe("choosing an organization model", () => {
  it("refuses one the organization never registered, everywhere", async () => {
    for (const [who, model] of [
      [a, "org:missing"],
      [b, MODEL],
    ] as const) {
      const override = await setModel(who, model);
      expect(override.status).toBe(422);
      expect(override.body.error?.code).toBe("unknown_model");
      expect(override.body.error?.message).toContain(model);
      const defaults = await call(who, "/defaults", {
        method: "PATCH",
        body: { model },
      });
      expect(defaults.body.error?.code).toBe("unknown_model");
      const allowed = await call(who, "/guardrails/allowed-models", {
        method: "PUT",
        body: { models: [model] },
      });
      expect(allowed.body.error?.code).toBe("unknown_model");
    }
    const deployed = await deploy(b, "invoices", orgModelAgent);
    expect(deployed.status).toBe(422);
    expect(deployed.body.error?.code).toBe("unknown_model");
    expect((await setModel(a, "org:Not Valid")).status).toBe(400);
  });

  it("deploys code that names a registered one", async () => {
    const deployed = await deploy(a, "invoices", orgModelAgent);
    expect(deployed.status).toBe(201);
    expect(deployed.body.status).toBe("ready");
    invoicesDeployment = deployed.body.id;
  });

  it("takes one as an agent setting and an eval run's model", async () => {
    expect((await setModel(a, MODEL)).status).toBe(200);
    const suite = await call<{ id: string }>(
      a,
      "/agents/network-agent/eval-suites",
      { body: { name: "Compare" } },
    );
    suiteId = suite.body.id;
    const runs = await call<{ runs: { model: string }[] }>(
      a,
      `/eval-suites/${suite.body.id}/runs`,
      { body: { models: [MODEL, "deepseek-v4.1-flash"] } },
    );
    expect(runs.status).toBe(202);
    expect(runs.body.runs.map((r) => r.model).sort()).toEqual([
      "deepseek-v4.1-flash",
      MODEL,
    ]);
    const unknown = await call(a, `/eval-suites/${suite.body.id}/runs`, {
      body: { models: ["org:missing"] },
    });
    expect(unknown.body.error?.code).toBe("unknown_model");
  });
});

describe("running on an organization model", () => {
  type CaseView = {
    caseId: string;
    status: string;
    capture: Array<{ kind: string; data: Record<string, unknown> }>;
  };

  const runCase = async (who: Who) => {
    const started = await call<{ id: string }>(who, "/cases", {
      body: { agent: "network-agent", text: "hello" },
    });
    if (started.status !== 202) return started;
    const { body: created } = await call<{ agent: { id: string } }>(
      who,
      `/cases/${started.body.id}`,
    );
    const caseKey = {
      organizationId: who.org,
      agentId: created.agent.id,
      caseId: started.body.id,
    };
    for (let i = 0; i < 200; i++) {
      const view = await (
        testEnv().RUNTIME.getCase(caseKey) as Promise<CaseView>
      ).catch(() => null);
      if (view && ["completed", "failed", "halted"].includes(view.status))
        return { status: 202, body: view };
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("timed out waiting for the case");
  };

  it("routes the case's model calls through the endpoint", async () => {
    const ran = await runCase(a);
    const view = ran.body as CaseView;
    expect(view.status).toBe("completed");
    expect(
      view.capture.find((e) => e.kind === "model.request")?.data,
    ).toMatchObject({ model: MODEL, endpoint: endpointId });
    // On our cloud the case itself is still metered; a call to the
    // organization's own endpoint is not (design doc 10).
    const usage = await withOrg(testEnv(), a.org, (tx) =>
      tx
        .select({ feature: usageRecords.feature })
        .from(usageRecords)
        .where(eq(usageRecords.caseId, view.caseId)),
    );
    expect(usage.map((u) => u.feature)).toContain("cases");
    expect(usage.map((u) => u.feature)).not.toContain("model_usage");
  });

  it("lists it under the allowed-models guardrail like a catalogue model", async () => {
    const narrowed = await call(a, "/guardrails/allowed-models", {
      method: "PUT",
      body: { models: ["deepseek-v4.1-flash"] },
    });
    expect(narrowed.status).toBe(200);
    const refused = await runCase(a);
    expect(refused.status).toBe(409);
    expect((refused.body as Failure).error.code).toBe("model_not_allowed");
    const listed = await call<{ id: string; allowed: boolean }[]>(a, "/models");
    expect(listed.body.find((m) => m.id === MODEL)?.allowed).toBe(false);
    expect(
      (
        await call<{ models: string[] }>(a, "/guardrails/allowed-models", {
          method: "PUT",
          body: { models: ["deepseek-v4.1-flash", MODEL] },
        })
      ).body.models,
    ).toEqual(["deepseek-v4.1-flash", MODEL]);
    expect(((await runCase(a)).body as CaseView).status).toBe("completed");
    await call(a, "/guardrails/allowed-models", {
      method: "PUT",
      body: { models: null },
    });
  });
});

describe("deleting an organization model", () => {
  it("is refused while a deployment, a setting or an eval run names it", async () => {
    // A run still going (the suite's runs above had no cases to wait on).
    await withOrg(testEnv(), a.org, (tx) =>
      tx.insert(evalRuns).values({
        id: newId("evalRun"),
        organizationId: a.org,
        suiteId,
        deploymentId,
        model: MODEL,
        trigger: "manual",
        status: "running",
        createdBy: "test",
      }),
    );
    const refused = await call<{ error: { refs: unknown[] } }>(
      a,
      `/models/endpoints/${endpointId}`,
      { method: "DELETE" },
    );
    expect(refused.status).toBe(409);
    expect(refused.body.error?.code).toBe("model_in_use");
    const anyId: unknown = expect.any(String);
    const refs = [
      {
        type: "deployment",
        agentId: anyId,
        agentName: "invoices",
        deploymentId: invoicesDeployment,
        production: true,
      },
      {
        type: "settings",
        agentId: anyId,
        agentName: "network-agent",
      },
      { type: "eval_suite", suiteId, suiteName: "Compare" },
    ];
    expect(refused.body.error.refs).toEqual(refs);
    expect(refused.body.error.message).toBe(
      `The model ${MODEL} is still in use by the invoices agent's production deployment ${invoicesDeployment}, the network-agent agent's settings, the eval suite Compare. Move those to another model first.`,
    );
    // The Models page opens the dialog in the same state.
    const listed = await call<{ id: string; usedBy?: unknown[] }[]>(
      a,
      "/models",
    );
    expect(listed.body.find((m) => m.id === MODEL)?.usedBy).toEqual(refs);
    expect(
      listed.body.find((m) => m.id === "kimi-k3.1-pro"),
    ).not.toHaveProperty("usedBy");
  });

  it("is not reachable from another organization", async () => {
    expect(
      (
        await call(b, `/models/endpoints/${endpointId}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(404);
  });
});
