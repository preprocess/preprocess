// Case sandboxes (spec 3, 5 and 16a): a deploy that asks for a sandbox needs a
// size, the organization's largest-size guardrail holds a larger one in
// waiting until an Owner or Admin approves, a dashboard override cannot pass
// it. Billing of awake time is tested in sandbox.test.ts.

import { orgId, withOrg, type OrgId } from "@preprocess/db/client";
import { auditEvents } from "@preprocess/db/schema/audit";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { sizeAllowed } from "../src/sandbox.ts";
import type { Client } from "./helpers.ts";
import { createOrganization, signUp, testEnv } from "./helpers.ts";
// Bundled by vitest.config.ts, as `preprocess deploy` bundles an agent.
import sandboxAgent from "./dist/sandbox-agent.js?raw";

type Deployment = {
  id: string;
  agentId: string;
  status: string;
  waitingFor: { sandboxSize?: string };
};
type Request = {
  id: string;
  status: string;
  change: { kind: string; size?: string };
};

const environment = testEnv();
let owner: Client;
let org: OrgId;

const eventually = async <T>(
  read: () => Promise<T>,
  done: (v: T) => boolean,
) => {
  for (let i = 0; i < 200; i++) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("timed out waiting");
};

const deploy = (slug: string, module: string) =>
  owner.call<Deployment & { error?: string; message?: string }>(
    `/v1/orgs/${org}/agents/${slug}/deployments`,
    {
      method: "POST",
      body: {
        bundle: { mainModule: "agent.js", modules: { "agent.js": module } },
        git: { branch: "main" },
      },
    },
  );

const status = async (slug: string, id: string) =>
  (
    await owner.call<Deployment>(
      `/v1/orgs/${org}/agents/${slug}/deployments/${id}`,
    )
  ).body;

beforeAll(async () => {
  owner = (await signUp("Sandboxer", environment)).client;
  org = orgId(await createOrganization(owner, "Sandco"));
});

describe("sandbox sizes", () => {
  it("rank smallest first, and no cap allows every size", () => {
    expect(sizeAllowed(null, "large")).toBe(true);
    expect(sizeAllowed("medium", "small")).toBe(true);
    expect(sizeAllowed("medium", "medium")).toBe(true);
    expect(sizeAllowed("medium", "large")).toBe(false);
  });
});

describe("deploying an agent with a sandbox", () => {
  it("fails when the manifest asks for a sandbox without a size", async () => {
    // What another bundler or an older SDK might serve.
    const sizeless = `export default { fetch: () => Response.json({
      protocol: 1, sdk: { name: "@preprocess/sdk", version: "0.0.9" },
      instructions: "x", model: "deepseek-v4.1-flash", reasoning: "medium",
      secrets: [], mcp: [], tools: [], sandbox: { preset: "python" },
    }) };`;
    const deployed = await deploy("sizeless", sizeless);
    expect(deployed.status).toBe(422);
    expect(JSON.stringify(deployed.body)).toContain(
      "sandbox.size is required: pick one of small, medium, large",
    );
  });

  it("waits for an Owner or Admin when the size passes the guardrail", async () => {
    const capped = await owner.call<{ size: string | null }>(
      `/v1/orgs/${org}/guardrails/sandbox-size`,
      { method: "PUT", body: { size: "medium" } },
    );
    expect(capped.status).toBe(200);
    expect(
      (
        await owner.call<{ sandboxMaxSize: string | null }>(
          `/v1/orgs/${org}/guardrails`,
        )
      ).body.sandboxMaxSize,
    ).toBe("medium");

    const deployed = await deploy("reconciler", sandboxAgent);
    expect(deployed.status).toBe(201);
    const waiting = await eventually(
      () => status("reconciler", deployed.body.id),
      (d) => d.status === "waiting",
    );
    expect(waiting.waitingFor.sandboxSize).toBe("large");

    // The size shows as the code's, and an override cannot pass the cap.
    const settings = await owner.call<{
      settings: { key: string; value: unknown; source: string }[];
    }>(`/v1/orgs/${org}/agents/reconciler/settings`);
    expect(
      settings.body.settings.find((s) => s.key === "sandbox.size"),
    ).toMatchObject({ value: "large", source: "code" });
    const tooBig = await owner.call(
      `/v1/orgs/${org}/agents/reconciler/settings/sandbox.size`,
      { method: "PUT", body: { value: "large" } },
    );
    expect(tooBig.status).toBe(409);
    const smaller = await owner.call(
      `/v1/orgs/${org}/agents/reconciler/settings/sandbox.size`,
      { method: "PUT", body: { value: "small" } },
    );
    expect(smaller.status).toBe(200);

    const requests = await owner.call<{ requests: Request[] } | Request[]>(
      `/v1/orgs/${org}/guardrail-requests?status=pending`,
    );
    const list = Array.isArray(requests.body)
      ? requests.body
      : requests.body.requests;
    const asked = list.find((r) => r.change.kind === "sandbox_size");
    expect(asked?.change.size).toBe("large");
    const approved = await owner.call<Request>(
      `/v1/orgs/${org}/guardrail-requests/${asked!.id}/approve`,
      { method: "POST" },
    );
    expect(approved.status).toBe(200);
    expect(
      (
        await owner.call<{ sandboxMaxSize: string | null }>(
          `/v1/orgs/${org}/guardrails`,
        )
      ).body.sandboxMaxSize,
    ).toBe("large");
    await eventually(
      () => status("reconciler", deployed.body.id),
      (d) => d.status === "ready",
    );
    const audited = await withOrg(environment, org, (tx) =>
      tx
        .select({ data: auditEvents.data })
        .from(auditEvents)
        .where(eq(auditEvents.action, "guardrail.updated")),
    );
    expect(audited.map((a) => a.data)).toContainEqual({
      guardrail: "sandbox_size",
      before: "medium",
      after: "large",
    });
  });
});
