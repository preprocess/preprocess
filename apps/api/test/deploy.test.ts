import { env } from "cloudflare:workers";
import { readAuditEvents, verifyAuditChain } from "@preprocess/db/audit";
import { orgId, withOrg, type OrgId } from "@preprocess/db/client";
import { beforeAll, describe, expect, it } from "vitest";

import { secretsVersion, secretValues } from "../src/deploy.ts";
import { Client, createOrganization, signUp, testEnv } from "./helpers.ts";
// Bundled by vitest.config.ts, as `preprocess deploy` bundles an agent.
import sampleAgent from "./dist/sample-agent.js?raw";

const ERP_V1 = "erp-live-7c1f9a";
const ERP_V2 = "erp-rotated-9d2e4b0c";

// Each organization calls with an API key, as `preprocess deploy` does.
type Who = { org: OrgId; client: Client };
const seedOrg = async (name: string): Promise<Who> => {
  const { client } = await signUp(name);
  const org = orgId(await createOrganization(client, name));
  const created = await client.call<{ key: string }>(
    "/api/auth/api-key/create",
    { body: { name: "deploy", organizationId: org } },
  );
  const keyed = new Client(testEnv(), {
    authorization: `Bearer ${created.body.key}`,
  });
  return { org, client: keyed };
};

let a: Who;
let b: Who;

beforeAll(async () => {
  a = await seedOrg("Acme");
  b = await seedOrg("Globex");
});

const call = async <T = unknown>(
  who: Who,
  method: string,
  path: string,
  body?: unknown,
  org = who.org,
) => {
  const response = await who.client.call<T>(path.replace("{org}", org), {
    method,
    ...(body !== undefined && { body }),
  });
  return { status: response.status, body: response.body };
};

type Deployment = {
  id: string;
  agentId: string;
  status: string;
  production: boolean;
  waitingFor: { secrets?: string[] };
  sdkVersion: string;
};
type CaseView = {
  status: string;
  answer?: string;
  capture: Array<{ kind: string; data: { output?: unknown } }>;
};

const eventually = async <T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
) => {
  for (let i = 0; i < 200; i++) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("timed out waiting");
};

const deployBody = {
  bundle: { mainModule: "agent.js", modules: { "agent.js": sampleAgent } },
  git: { branch: "main", commit: "abc1234" },
};

const runCase = async (who: Who) => {
  const started = await call<{ id: string }>(
    who,
    "POST",
    "/v1/orgs/{org}/cases",
    { agent: "stock", text: "Check stock for SKU A1." },
  );
  expect(started.status).toBe(202);
  const { body: created } = await call<{ agent: { id: string } }>(
    who,
    "GET",
    `/v1/orgs/{org}/cases/${started.body.id}`,
  );
  // The case starts from the queue; its capture is read from the runtime.
  const key = {
    organizationId: who.org,
    agentId: created.agent.id,
    caseId: started.body.id,
  };
  return eventually(
    () =>
      (testEnv().RUNTIME.getCase(key) as Promise<CaseView>).catch(
        () => ({ status: "queued" }) as CaseView,
      ),
    (view) => view.status === "completed" || view.status === "failed",
  );
};

const lookupOutput = (view: CaseView) =>
  view.capture.find((e) => e.kind === "tool.result")?.data.output as {
    authorization: string;
    tokenLength: number;
  };

describe("auth", () => {
  it("refuses calls without a key, and a key on another organization's path", async () => {
    const none = new Client(testEnv());
    expect((await none.call(`/v1/orgs/${a.org}/agents`)).status).toBe(401);
    expect(
      (await call(b, "GET", "/v1/orgs/{org}/agents", undefined, a.org)).status,
    ).toBe(403);
    expect(
      (
        await call(
          b,
          "POST",
          "/v1/orgs/{org}/agents/stock/deployments",
          {},
          a.org,
        )
      ).status,
    ).toBe(403);
  });
});

describe("deploy, secrets and one case end to end", () => {
  let first: Deployment;

  it("creates the agent on its first deploy and waits for an ungranted secret", async () => {
    const deployed = await call<Deployment>(
      a,
      "POST",
      "/v1/orgs/{org}/agents/stock/deployments",
      deployBody,
    );
    expect(deployed.status).toBe(201);
    first = deployed.body;
    expect(first).toMatchObject({
      status: "waiting",
      production: false,
      sdkVersion: "0.1.0",
      waitingFor: { secrets: ["ERP_TOKEN"] },
    });
    const promote = await call(
      a,
      "POST",
      `/v1/orgs/{org}/agents/stock/deployments/${first.id}/promote`,
    );
    expect(promote.status).toBe(409);
  });

  it("delivers a granted secret to the deployment, which can then be promoted", async () => {
    expect(
      (
        await call(a, "PUT", "/v1/orgs/{org}/secrets/ERP_TOKEN", {
          value: ERP_V1,
        })
      ).body,
    ).toEqual({ name: "ERP_TOKEN", version: 1 });
    expect(
      (await call(a, "PUT", "/v1/orgs/{org}/secrets/ERP_TOKEN/agents/stock"))
        .status,
    ).toBe(204);
    await eventually(
      async () =>
        (
          await call<Deployment>(
            a,
            "GET",
            `/v1/orgs/{org}/agents/stock/deployments/${first.id}`,
          )
        ).body,
      (d) => d.status === "ready",
    );
    const promoted = await call<Deployment>(
      a,
      "POST",
      `/v1/orgs/{org}/agents/stock/deployments/${first.id}/promote`,
    );
    expect(promoted.body).toMatchObject({ status: "ready", production: true });
  });

  it("lists an agent's deployments by environment, as preprocess rollback reads them", async () => {
    const preview = await call<Deployment>(
      a,
      "POST",
      "/v1/orgs/{org}/agents/stock/deployments",
      { ...deployBody, git: { branch: "feature/faster", commit: "def5678" } },
    );
    expect(preview.status).toBe(201);
    const list = async (environment: string) =>
      (
        await call<Array<{ id: string; environment: string }>>(
          a,
          "GET",
          `/v1/orgs/{org}/agents/stock/deployments?environment=${environment}`,
        )
      ).body;
    const production = await list("production");
    expect(production.map((d) => d.id)).toContain(first.id);
    expect(production.every((d) => d.environment === "production")).toBe(true);
    expect((await list("preview")).map((d) => d.id)).toEqual([preview.body.id]);
  });

  it("runs a case where only the deployed code sees the secret", async () => {
    const view = await runCase(a);
    expect(view.status).toBe("completed");
    expect(lookupOutput(view)).toMatchObject({
      authorization: "Bearer [redacted:ERP_TOKEN]",
      tokenLength: ERP_V1.length,
    });
    expect(JSON.stringify(view)).not.toContain(ERP_V1);
  });

  it("gives the live deployment a rotated value on its next call, without a redeploy", async () => {
    const ref = {
      organizationId: a.org,
      agentId: first.agentId,
      deploymentId: first.id,
    };
    const before = await secretsVersion(testEnv(), ref);
    expect(
      (
        await call(a, "PUT", "/v1/orgs/{org}/secrets/ERP_TOKEN", {
          value: ERP_V2,
        })
      ).body,
    ).toMatchObject({ version: 2 });
    expect(await secretsVersion(testEnv(), ref)).not.toBe(before);
    const view = await runCase(a);
    expect(lookupOutput(view).tokenLength).toBe(ERP_V2.length);
  });

  it("refuses to delete a secret a live deployment holds", async () => {
    expect(
      (await call(a, "DELETE", "/v1/orgs/{org}/secrets/ERP_TOKEN")).status,
    ).toBe(409);
  });

  it("withdraws a revoked secret from the next call, and starts no case until it is back", async () => {
    const ref = {
      organizationId: a.org,
      agentId: first.agentId,
      deploymentId: first.id,
    };
    expect((await secretValues(testEnv(), ref)).values).toHaveProperty(
      "ERP_TOKEN",
    );
    expect(
      (await call(a, "DELETE", "/v1/orgs/{org}/secrets/ERP_TOKEN/agents/stock"))
        .status,
    ).toBe(204);
    expect(await secretValues(testEnv(), ref)).toEqual({
      version: "none",
      values: {},
    });
    expect(
      (await call<Array<{ live: number }>>(a, "GET", "/v1/orgs/{org}/secrets"))
        .body[0],
    ).toMatchObject({ live: 0 });
    expect(
      (
        await call<Deployment>(
          a,
          "GET",
          `/v1/orgs/{org}/agents/stock/deployments/${first.id}`,
        )
      ).body,
    ).toMatchObject({
      status: "waiting",
      waitingFor: { secrets: ["ERP_TOKEN"] },
    });
    const refused = await call<{ code: string }>(
      a,
      "POST",
      "/v1/orgs/{org}/cases",
      {
        agent: "stock",
        text: "Check stock for SKU A1.",
      },
    );
    expect(refused.status).toBe(409);
  });

  it("audits deliveries by name and version, never by value, on an intact chain", async () => {
    const events = await withOrg(env, a.org, (tx) =>
      readAuditEvents(tx, a.org),
    );
    const actions = events.map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "agent.created",
        "deployment.created",
        "secret.created",
        "secret.granted",
        "secret.delivered",
        "deployment.promoted",
        "secret.updated",
        "secret.revoked",
      ]),
    );
    expect(JSON.stringify(events)).not.toContain(ERP_V1);
    expect(JSON.stringify(events)).not.toContain(ERP_V2);
    expect(
      (await withOrg(env, a.org, (tx) => verifyAuditChain(tx, a.org))).ok,
    ).toBe(true);
  });
});

describe("tenant isolation", () => {
  it("keeps one organization's agents, deployments and secrets from another", async () => {
    expect(
      (await call<unknown[]>(b, "GET", "/v1/orgs/{org}/agents")).body,
    ).toEqual([]);
    expect((await call(b, "GET", "/v1/orgs/{org}/agents/stock")).status).toBe(
      404,
    );
    expect(
      (await call<unknown[]>(b, "GET", "/v1/orgs/{org}/secrets")).body,
    ).toEqual([]);
    expect(
      (await call(b, "PUT", "/v1/orgs/{org}/secrets/ERP_TOKEN/agents/stock"))
        .status,
    ).toBe(404);
  });

  it("gives the same agent name in another organization its own agent and secrets", async () => {
    await call(b, "PUT", "/v1/orgs/{org}/secrets/ERP_TOKEN", {
      value: "globex-only-token",
    });
    const deployed = await call<Deployment>(
      b,
      "POST",
      "/v1/orgs/{org}/agents/stock/deployments",
      deployBody,
    );
    expect(deployed.body).toMatchObject({
      status: "waiting",
      waitingFor: { secrets: ["ERP_TOKEN"] },
    });
    const agents = await call<Array<{ id: string }>>(
      a,
      "GET",
      "/v1/orgs/{org}/agents",
    );
    const other = await call<Array<{ id: string }>>(
      b,
      "GET",
      "/v1/orgs/{org}/agents",
    );
    expect(agents.body[0]!.id).not.toBe(other.body[0]!.id);
  });
});
