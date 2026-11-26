// The allowed-models guardrail (spec 5): Owners and Admins set the catalogue
// models agents may run on, and every path that picks a model refuses one
// outside the list by name: deploys, settings, case starts and eval runs.

import { orgId, type OrgId } from "@preprocess/db/client";
import { beforeAll, describe, expect, it } from "vitest";

import {
  addMember,
  Client,
  createOrganization,
  signUp,
  testEnv,
} from "./helpers.ts";
// Bundled by vitest.config.ts, as `preprocess deploy` bundles an agent.
import networkAgent from "./dist/network-agent.js?raw";

type Failure = { error: { code: string; message: string } };

let org: OrgId;
let owner: Client;
let admin: Client;
let member: Client;
let key: Client;

const deploy = () =>
  key.call<{ id: string; status: string } & Partial<Failure>>(
    `/v1/orgs/${org}/agents/network-agent/deployments`,
    {
      body: {
        bundle: {
          mainModule: "agent.js",
          modules: { "agent.js": networkAgent },
        },
        git: { branch: "main" },
      },
    },
  );

const allow = (client: Client, models: string[] | null) =>
  client.call<{ models: string[] | null }>(
    `/v1/orgs/${org}/guardrails/allowed-models`,
    { method: "PUT", body: { models } },
  );

beforeAll(async () => {
  const signed = await signUp("Modeler");
  owner = signed.client;
  org = orgId(await createOrganization(owner, "Modelco"));
  admin = (await addMember(owner, org, "Admin", "admin")).client;
  member = (await addMember(owner, org, "Plain")).client;
  const created = await owner.call<{ key: string }>(
    "/api/auth/api-key/create",
    { body: { name: "deploy", organizationId: org } },
  );
  key = new Client(testEnv(), {
    authorization: `Bearer ${created.body.key}`,
  });
});

describe("allowed models", () => {
  it("allow every model until an Owner or Admin sets a list", async () => {
    const guardrails = await owner.call<{ allowedModels: string[] | null }>(
      `/v1/orgs/${org}/guardrails`,
    );
    expect(guardrails.body.allowedModels).toBeNull();
    expect((await allow(member, ["deepseek-v4.1-flash"])).status).toBe(403);
    expect((await allow(owner, ["not-a-model"])).status).toBe(400);
    expect((await allow(owner, [])).status).toBe(400);
    const set = await allow(admin, ["deepseek-v4.1-flash"]);
    expect(set.status).toBe(200);
    expect(set.body.models).toEqual(["deepseek-v4.1-flash"]);
  });

  it("let a deploy and settings on an allowed model through", async () => {
    const deployed = await deploy();
    expect(deployed.status).toBe(201);
    expect(deployed.body.status).toBe("ready");
    const override = await key.call(
      `/v1/orgs/${org}/agents/network-agent/settings/model`,
      { method: "PUT", body: { value: "deepseek-v4.1-flash" } },
    );
    expect(override.status).toBe(200);
  });

  it("refuse settings that pick a model outside the list, naming it", async () => {
    const override = await key.call<Failure>(
      `/v1/orgs/${org}/agents/network-agent/settings/model`,
      { method: "PUT", body: { value: "kimi-k3.1-pro" } },
    );
    expect(override.status).toBe(409);
    expect(override.body.error.code).toBe("model_not_allowed");
    expect(override.body.error.message).toContain("Kimi K3.1 Pro");
    const defaults = await owner.call<Failure>(`/v1/orgs/${org}/defaults`, {
      method: "PATCH",
      body: { model: "kimi-k3.1-pro" },
    });
    expect(defaults.status).toBe(409);
    expect(defaults.body.error.code).toBe("model_not_allowed");
  });

  it("refuse deploys, case starts and eval runs once their model is taken off", async () => {
    expect((await allow(owner, ["kimi-k3.1-pro"])).status).toBe(200);
    const deployed = await deploy();
    expect(deployed.status).toBe(409);
    expect(deployed.body.error?.code).toBe("model_not_allowed");
    expect(deployed.body.error?.message).toContain(
      "DeepSeek V4.1 Flash (deepseek-v4.1-flash)",
    );

    const started = await key.call<Failure>(`/v1/orgs/${org}/cases`, {
      body: { agent: "network-agent", text: "hello" },
    });
    expect(started.status).toBe(409);
    expect(started.body.error.code).toBe("model_not_allowed");

    const suite = await owner.call<{ id: string }>(
      `/v1/orgs/${org}/agents/network-agent/eval-suites`,
      { body: { name: "Smoke" } },
    );
    const run = await owner.call<Failure>(
      `/v1/orgs/${org}/eval-suites/${suite.body.id}/runs`,
      { body: { models: ["deepseek-v4.1-flash"] } },
    );
    expect(run.status).toBe(409);
    expect(run.body.error.code).toBe("model_not_allowed");
  });

  it("allow every model again when the list is cleared", async () => {
    const cleared = await allow(owner, null);
    expect(cleared.body.models).toBeNull();
    expect((await deploy()).body.status).toBe("ready");
  });
});
