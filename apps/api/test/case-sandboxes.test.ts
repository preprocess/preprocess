// Case sandboxes (spec 3, 5 and 16a): a deploy that asks for a sandbox needs a
// size, the organization's largest-size guardrail holds a larger one in
// waiting until an Owner or Admin approves, the size is set in code only (no
// dashboard override, and a stored one is ignored), and who may read a case's
// sandbox time. Billing of awake time is tested
// in sandbox.test.ts.

import { orgId, withOrg, type OrgId } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { agents } from "@preprocess/db/schema/access";
import { auditEvents } from "@preprocess/db/schema/audit";
import { cases } from "@preprocess/db/schema/cases";
import { deployments } from "@preprocess/db/schema/deployments";
import { agentOverrides } from "@preprocess/db/schema/settings";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { recordSandboxEvent, sizeAllowed } from "../src/sandbox.ts";
import type { Client } from "./helpers.ts";
import { addMember, createOrganization, signUp, testEnv } from "./helpers.ts";
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

    // The size is the code's and cannot be overridden from the dashboard.
    const sizeSetting = async () => {
      const read = await owner.call<{
        settings: {
          key: string;
          value: unknown;
          source: string;
          override: unknown;
        }[];
        warnings: string[];
      }>(`/v1/orgs/${org}/agents/reconciler/settings`);
      return {
        setting: read.body.settings.find((s) => s.key === "sandbox.size"),
        warnings: read.body.warnings,
      };
    };
    expect((await sizeSetting()).setting).toMatchObject({
      value: "large",
      source: "code",
      override: null,
    });
    for (const value of ["small", "large"]) {
      const put = await owner.call<{ error: { code: string } }>(
        `/v1/orgs/${org}/agents/reconciler/settings/sandbox.size`,
        { method: "PUT", body: { value } },
      );
      expect(put.status).toBe(404);
      expect(put.body.error.code).toBe("not_found");
    }
    const cleared = await owner.call(
      `/v1/orgs/${org}/agents/reconciler/settings/sandbox.size`,
      { method: "DELETE" },
    );
    expect(cleared.status).toBe(404);

    // An override stored before the size became code-only is ignored.
    await withOrg(environment, org, (tx) =>
      tx.insert(agentOverrides).values({
        organizationId: org,
        agentId: deployed.body.agentId,
        values: { "sandbox.size": "small" },
        updatedBy: "usr_test",
      }),
    );
    const stored = await sizeSetting();
    expect(stored.setting).toMatchObject({
      value: "large",
      source: "code",
      override: null,
    });
    expect(stored.warnings.join("\n")).not.toContain("sandbox.size");

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

describe("reading a case's sandbox time", () => {
  type Intervals = {
    intervals: {
      seq: number;
      size: string;
      startedAt: string;
      endedAt: string | null;
      endReason: string | null;
    }[];
  };
  const caseId = newId("case");
  const at = (time: string) => new Date(`2026-11-26T${time}Z`);

  beforeAll(async () => {
    const agentId = newId("agent");
    const deploymentId = newId("deployment");
    await withOrg(environment, org, async (tx) => {
      await tx
        .insert(agents)
        .values({ id: agentId, organizationId: org, slug: "timed" });
      await tx.insert(deployments).values({
        id: deploymentId,
        organizationId: org,
        agentId,
        environment: "production",
        status: "ready",
        bundleSha256: "00",
        sdkVersion: "0.1.0",
        manifest: {},
        source: "cli",
        createdBy: "seed",
        promotedAt: new Date(),
      });
      await tx.insert(cases).values({
        id: caseId,
        organizationId: org,
        agentId,
        deploymentId,
        status: "completed",
        source: "api",
      });
    });
    const send = (
      type: "start" | "wake" | "sleep" | "destroy",
      seq: number,
      time: string,
    ) =>
      recordSandboxEvent(
        environment,
        {
          sandboxId: `sbx_${caseId}`,
          seq,
          type,
          organizationId: org,
          agent: agentId,
          caseId,
          kind: "case",
          size: "small",
        },
        at(time),
      );
    await send("start", 1, "09:00:00");
    await send("sleep", 1, "09:05:00");
    await send("wake", 2, "09:20:00");
    await send("destroy", 2, "09:21:30");
  });

  it("lists each awake interval, oldest first, to someone who can see the case", async () => {
    const res = await owner.call<Intervals>(
      `/v1/orgs/${org}/cases/${caseId}/sandbox`,
    );
    expect(res.status).toBe(200);
    expect(res.body.intervals).toEqual([
      {
        seq: 1,
        size: "small",
        startedAt: at("09:00:00").toISOString(),
        endedAt: at("09:05:00").toISOString(),
        endReason: "sleep",
      },
      {
        seq: 2,
        size: "small",
        startedAt: at("09:20:00").toISOString(),
        endedAt: at("09:21:30").toISOString(),
        endReason: "destroy",
      },
    ]);
  });

  it("hides the case from a member without access to its agent", async () => {
    const member = (await addMember(owner, org, "Sandbox Reader")).client;
    const res = await member.call(`/v1/orgs/${org}/cases/${caseId}/sandbox`);
    expect(res.status).toBe(404);
  });

  it("never shows one organization's case to another", async () => {
    const other = (await signUp("Sandbox Outsider", environment)).client;
    const otherOrg = await createOrganization(other, "Elsewhere");
    const own = await other.call(
      `/v1/orgs/${otherOrg}/cases/${caseId}/sandbox`,
    );
    expect(own.status).toBe(404);
    const theirs = await other.call(`/v1/orgs/${org}/cases/${caseId}/sandbox`);
    expect([403, 404]).toContain(theirs.status);
  });
});
