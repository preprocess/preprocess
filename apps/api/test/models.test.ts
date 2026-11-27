// The model catalogue and registered endpoints (design doc 10, section 4):
// any member reads the catalogue, only Owners and Admins register, change,
// test or delete an endpoint, the key is encrypted and never returned, another
// organization sees none of it, and a case on an overridden model is served
// by the endpoint.

import { orgId, withOrg, type OrgId } from "@preprocess/db/client";
import { auditEvents } from "@preprocess/db/schema/audit";
import { modelEndpoints } from "@preprocess/db/schema/models";
import { like } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { registeredEndpoints } from "../src/model-endpoints.ts";
import { MODEL_KEY, MODEL_ORIGIN } from "./fake-model.ts";
import {
  addMember,
  Client,
  createOrganization,
  signUp,
  testEnv,
} from "./helpers.ts";
// Bundled by vitest.config.ts, as `preprocess deploy` bundles an agent.
import networkAgent from "./dist/network-agent.js?raw";

type Endpoint = {
  id: string;
  model: string;
  kind: string;
  url: string;
  providerModel: string;
  hasKey: boolean;
};
type Listed = {
  id: string;
  kind: string;
  serving: string;
  allowed: boolean;
  label: string;
  baseModel?: string | null;
  endpoint: Endpoint | null;
};
type Failure = { error: { code: string; message: string } };

let org: OrgId;
let owner: Client;
let admin: Client;
let developer: Client;
let member: Client;
let key: Client;
let other: Client;
let otherOrg: OrgId;

const path = (rest: string, o: string = org) => `/v1/orgs/${o}${rest}`;

const register = (client: Client, body: unknown, o: string = org) =>
  client.call<Endpoint & Partial<Failure>>(path("/models/endpoints", o), {
    body,
  });

beforeAll(async () => {
  owner = (await signUp("Modeler")).client;
  org = orgId(await createOrganization(owner, "Endpointco"));
  admin = (await addMember(owner, org, "Admin", "admin")).client;
  developer = (await addMember(owner, org, "Dev")).client;
  member = (await addMember(owner, org, "Plain")).client;
  const created = await owner.call<{ key: string }>(
    "/api/auth/api-key/create",
    { body: { name: "deploy", organizationId: org } },
  );
  key = new Client(testEnv(), {
    authorization: `Bearer ${created.body.key}`,
  });
  other = (await signUp("Rival")).client;
  otherOrg = orgId(await createOrganization(other, "Rivalco"));
});

describe("model catalogue", () => {
  it("lists every catalogue model to any member, served by its provider", async () => {
    const listed = await member.call<Listed[]>(path("/models"));
    expect(listed.status).toBe(200);
    expect(listed.body.map((m) => m.id)).toEqual([
      "kimi-k3.1-pro",
      "deepseek-v4.1-flash",
      "deepseek-v4.1-flash-fast",
      "qwen3.8-27b",
    ]);
    expect(listed.body[3]).toMatchObject({
      kind: "catalog",
      serving: "workers-ai",
      allowed: true,
      trainable: false,
      endpoint: null,
    });
  });

  it("lets only Owners and Admins register an endpoint", async () => {
    const body = {
      model: "kimi-k3.1-pro",
      url: MODEL_ORIGIN,
      key: MODEL_KEY,
    };
    expect((await register(member, body)).status).toBe(403);
    expect((await register(developer, body)).status).toBe(403);
    expect((await new Client(testEnv()).call(path("/models"))).status).toBe(
      401,
    );
    const created = await register(admin, body);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      model: "kimi-k3.1-pro",
      kind: "override",
      url: MODEL_ORIGIN,
      providerModel: "moonshotai/Kimi-K3.1-Pro",
      hasKey: true,
    });
    expect(JSON.stringify(created.body)).not.toContain(MODEL_KEY);
    expect((await register(owner, body)).body.error?.code).toBe(
      "endpoint_exists",
    );
  });

  it("refuses URLs that are not an https base, and unknown models", async () => {
    for (const url of [
      "http://models.test",
      "https://user:pw@models.test",
      "https://models.test/v1?key=1",
      "https://models.test/openai",
      "not a url",
    ])
      expect(
        (await register(owner, { model: "qwen3.8-27b", url })).status,
      ).toBe(400);
    const unknown = await register(owner, {
      model: "gpt-unknown",
      url: MODEL_ORIGIN,
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error?.code).toBe("invalid_request");
    expect(
      (
        await register(owner, {
          model: "qwen3.8-27b",
          url: MODEL_ORIGIN,
          label: "Mine",
        })
      ).status,
    ).toBe(400);
    expect(
      (await register(owner, { model: "org:tuned", url: MODEL_ORIGIN })).status,
    ).toBe(400);
  });

  it("registers an organization model by endpoint and lists it", async () => {
    const created = await register(key, {
      model: "org:invoices-v2",
      url: `${MODEL_ORIGIN}/v1`,
      providerModel: "invoices-v2",
      label: "Invoices v2",
      baseModel: "qwen3.8-27b",
      checkpoint: "tinker://run/123/step-400",
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ kind: "model", hasKey: false });
    const listed = await member.call<Listed[]>(path("/models"));
    expect(listed.body.find((m) => m.id === "org:invoices-v2")).toMatchObject({
      kind: "model",
      label: "Invoices v2",
      baseModel: "qwen3.8-27b",
      checkpoint: "tinker://run/123/step-400",
      serving: "endpoint",
      allowed: true,
    });
    expect(listed.body.find((m) => m.id === "kimi-k3.1-pro")).toMatchObject({
      serving: "endpoint",
      endpoint: { hasKey: true },
    });
    expect(JSON.stringify(listed.body)).not.toContain(MODEL_KEY);
  });

  it("stores the key encrypted and audits without it", async () => {
    const stored = await withOrg(testEnv(), org, (tx) =>
      tx.select().from(modelEndpoints),
    );
    const kimi = stored.find((r) => r.model === "kimi-k3.1-pro")!;
    expect(kimi.keyCiphertext).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(kimi.keyCiphertext!)).not.toContain(
      MODEL_KEY,
    );
    const events = await withOrg(testEnv(), org, (tx) =>
      tx
        .select()
        .from(auditEvents)
        .where(like(auditEvents.action, "model_endpoint.%")),
    );
    expect(events.map((e) => e.action)).toContain("model_endpoint.created");
    expect(JSON.stringify(events)).not.toContain(MODEL_KEY);
  });

  it("reports the organization's endpoints in guardrails, by host only", async () => {
    const guardrails = await member.call<{
      modelEndpoints: { kind: string; endpoints: unknown[] };
    }>(path("/guardrails"));
    expect(guardrails.body.modelEndpoints).toEqual({
      kind: "own",
      endpoints: [
        { model: "kimi-k3.1-pro", host: "models.test" },
        { model: "org:invoices-v2", host: "models.test" },
      ],
    });
  });

  it("tests an endpoint with one tiny completion", async () => {
    const kimi = (await member.call<Listed[]>(path("/models"))).body.find(
      (m) => m.id === "kimi-k3.1-pro",
    )!.endpoint!;
    const test = (client: Client) =>
      client.call<{ ok: boolean; status: number | null; error: string | null }>(
        path(`/models/endpoints/${kimi.id}/test`),
        { method: "POST" },
      );
    expect((await test(member)).status).toBe(403);
    const passed = await test(owner);
    expect(passed.status).toBe(200);
    expect(passed.body).toMatchObject({ ok: true, status: 200, error: null });
    const changed = await admin.call<Endpoint>(
      path(`/models/endpoints/${kimi.id}`),
      { method: "PATCH", body: { key: null } },
    );
    expect(changed.body.hasKey).toBe(false);
    const refused = await test(owner);
    expect(refused.body).toMatchObject({ ok: false, status: 401 });
    expect(
      (
        await owner.call(path(`/models/endpoints/${kimi.id}`), {
          method: "PATCH",
          body: { key: MODEL_KEY },
        })
      ).status,
    ).toBe(200);
    expect((await test(owner)).body.ok).toBe(true);
  });

  it("hands the runtime the decrypted endpoints of its own organization only", async () => {
    const own = await registeredEndpoints(testEnv(), org);
    expect(own["kimi-k3.1-pro"]).toMatchObject({
      url: MODEL_ORIGIN,
      key: MODEL_KEY,
      model: "moonshotai/Kimi-K3.1-Pro",
    });
    expect(own["org:invoices-v2"]).toMatchObject({ key: "" });
    expect(await registeredEndpoints(testEnv(), otherOrg)).toEqual({});
  });
});

describe("tenant isolation", () => {
  it("shows, changes, tests and deletes no other organization's endpoint", async () => {
    const mine = (await member.call<Listed[]>(path("/models"))).body.find(
      (m) => m.id === "kimi-k3.1-pro",
    )!.endpoint!;
    expect((await other.call(path("/models"))).status).toBe(403);
    expect(
      (await register(other, { model: "kimi-k3.1-pro", url: MODEL_ORIGIN }))
        .status,
    ).toBe(403);
    const theirs = await other.call<Listed[]>(path("/models", otherOrg));
    expect(theirs.body.every((m) => m.endpoint === null)).toBe(true);
    for (const [method, suffix, body] of [
      ["PATCH", "", { url: "https://evil.test" }],
      ["POST", "/test", undefined],
      ["DELETE", "", undefined],
    ] as const)
      expect(
        (
          await other.call(
            path(`/models/endpoints/${mine.id}${suffix}`, otherOrg),
            { method, body },
          )
        ).status,
      ).toBe(404);
    const guardrails = await other.call<{ modelEndpoints: unknown }>(
      path("/guardrails", otherOrg),
    );
    expect(guardrails.body.modelEndpoints).toEqual({
      kind: "hosted",
      endpoints: [],
    });
  });
});

describe("runtime routing", () => {
  type CaseView = {
    status: string;
    capture: Array<{ kind: string; data: Record<string, unknown> }>;
  };

  const runCase = async () => {
    const started = await key.call<{ id: string }>(path("/cases"), {
      body: { agent: "network-agent", text: "hello" },
    });
    expect(started.status).toBe(202);
    const { body: created } = await key.call<{ agent: { id: string } }>(
      path(`/cases/${started.body.id}`),
    );
    const caseKey = {
      organizationId: org,
      agentId: created.agent.id,
      caseId: started.body.id,
    };
    for (let i = 0; i < 200; i++) {
      const view = await (
        testEnv().RUNTIME.getCase(caseKey) as Promise<CaseView>
      ).catch(() => null);
      if (view && ["completed", "failed", "halted"].includes(view.status))
        return view;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("timed out waiting for the case");
  };

  it("sends a catalogue model's calls to the organization's endpoint", async () => {
    const deployed = await key.call<{ status: string }>(
      path("/agents/network-agent/deployments"),
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
    expect(deployed.body.status).toBe("ready");

    // The runtime's internet serves model-stub.test from the stub, which only
    // knows the catalogue's provider names: a name it doesn't serve proves
    // the call went through the registered endpoint.
    const created = await register(owner, {
      model: "deepseek-v4.1-flash",
      url: "https://model-stub.test",
      providerModel: "acme/not-served",
      key: "test",
    });
    expect(created.status).toBe(201);
    const refused = await runCase();
    const request = refused.capture.find((e) => e.kind === "model.request");
    expect(request?.data).toMatchObject({
      model: "deepseek-v4.1-flash",
      endpoint: created.body.id,
    });
    expect(JSON.stringify(refused.capture)).toContain("acme/not-served");

    const fixed = await owner.call<Endpoint>(
      path(`/models/endpoints/${created.body.id}`),
      {
        method: "PATCH",
        body: { providerModel: "deepseek-ai/DeepSeek-V4.1-Flash-1017" },
      },
    );
    expect(fixed.status).toBe(200);
    const served = await runCase();
    expect(served.status).toBe("completed");
    expect(
      served.capture.find((e) => e.kind === "model.request")?.data.endpoint,
    ).toBe(created.body.id);

    expect(
      (
        await owner.call(path(`/models/endpoints/${created.body.id}`), {
          method: "DELETE",
        })
      ).status,
    ).toBe(204);
    const provider = await runCase();
    expect(provider.status).toBe("completed");
    expect(
      provider.capture.find((e) => e.kind === "model.request")?.data,
    ).not.toHaveProperty("endpoint");
  });
});
