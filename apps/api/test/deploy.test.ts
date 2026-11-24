import { env, exports } from "cloudflare:workers";
import {
  verifyAuditChain,
  readAuditEvents,
  startAuditChain,
} from "@preprocess/db/audit";
import { orgId, withOrg, withoutOrg } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { apikey, member, organization, user } from "@preprocess/db/schema/auth";
import { beforeAll, describe, expect, it } from "vitest";

// Bundled by vitest.config.ts, as `preprocess deploy` bundles an agent.
import sampleAgent from "./dist/sample-agent.js?raw";

const api = (exports as unknown as { default: Fetcher }).default;
const ERP_V1 = "erp-live-7c1f9a";
const ERP_V2 = "erp-rotated-9d2e4b0c";

const hashKey = async (key: string) =>
  btoa(
    String.fromCharCode(
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)),
      ),
    ),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const seedOrg = async (name: string) => {
  const org = orgId(newId("organization"));
  const userId = newId("user");
  const key = `pp_${crypto.randomUUID()}`;
  await withoutOrg(env, "test fixture", async (tx) => {
    const now = new Date();
    await tx
      .insert(user)
      .values({ id: userId, name, email: `${userId}@test.dev` });
    await tx
      .insert(organization)
      .values({ id: org, name, slug: org, createdAt: now, createdBy: userId });
    await startAuditChain(tx, org);
    await tx
      .insert(member)
      .values({
        id: newId("member"),
        organizationId: org,
        userId,
        role: "owner",
        createdAt: now,
      });
    await tx.insert(apikey).values({
      id: newId("apikey"),
      referenceId: org,
      key: await hashKey(key),
      createdAt: now,
      updatedAt: now,
    });
  });
  return { org, key };
};

let a: Awaited<ReturnType<typeof seedOrg>>;
let b: Awaited<ReturnType<typeof seedOrg>>;

beforeAll(async () => {
  a = await seedOrg("Acme");
  b = await seedOrg("Globex");
});

const call = async <T = unknown>(
  who: { org: string; key: string },
  method: string,
  path: string,
  body?: unknown,
  org = who.org,
) => {
  const response = await api.fetch(
    `https://api.test${path.replace("{org}", org)}`,
    {
      method,
      headers: {
        authorization: `Bearer ${who.key}`,
        "content-type": "application/json",
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    },
  );
  const text = await response.text();
  return {
    status: response.status,
    body: (text ? JSON.parse(text) : null) as T,
  };
};

type Deployment = {
  id: string;
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

const runCase = async (who: { org: string; key: string }) => {
  const started = await call<CaseView & { caseId: string }>(
    who,
    "POST",
    "/dev/orgs/{org}/agents/stock/cases",
    {
      text: "Check stock for SKU A1.",
    },
  );
  expect(started.status).toBe(202);
  return eventually(
    async () =>
      (
        await call<CaseView>(
          who,
          "GET",
          `/dev/orgs/{org}/agents/stock/cases/${started.body.caseId}`,
        )
      ).body,
    (view) => view.status !== "running",
  );
};

const lookupOutput = (view: CaseView) =>
  view.capture.find((e) => e.kind === "tool.result")?.data.output as {
    authorization: string;
    tokenLength: number;
  };

describe("auth", () => {
  it("refuses calls without a key, and a key on another organization's path", async () => {
    const none = await api.fetch(`https://api.test/v1/orgs/${a.org}/agents`);
    expect(none.status).toBe(401);
    expect(
      (await call(b, "GET", "/v1/orgs/{org}/agents", undefined, a.org)).status,
    ).toBe(401);
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

  it("runs a case where only the deployed code sees the secret", async () => {
    const view = await runCase(a);
    expect(view.status).toBe("completed");
    expect(lookupOutput(view)).toMatchObject({
      authorization: "Bearer [redacted:ERP_TOKEN]",
      tokenLength: ERP_V1.length,
    });
    expect(JSON.stringify(view)).not.toContain(ERP_V1);
  });

  it("resyncs a rotated value to the live deployment without a redeploy", async () => {
    expect(
      (
        await call(a, "PUT", "/v1/orgs/{org}/secrets/ERP_TOKEN", {
          value: ERP_V2,
        })
      ).body,
    ).toMatchObject({ version: 2 });
    await eventually(
      async () =>
        (
          await call<Array<{ delivered: number }>>(
            a,
            "GET",
            "/v1/orgs/{org}/secrets",
          )
        ).body[0]!,
      (s) => s.delivered === 1,
    );
    const view = await runCase(a);
    expect(lookupOutput(view).tokenLength).toBe(ERP_V2.length);
  });

  it("refuses to delete a secret a live deployment holds", async () => {
    expect(
      (await call(a, "DELETE", "/v1/orgs/{org}/secrets/ERP_TOKEN")).status,
    ).toBe(409);
  });

  it("removes the binding when the grant is revoked", async () => {
    expect(
      (await call(a, "DELETE", "/v1/orgs/{org}/secrets/ERP_TOKEN/agents/stock"))
        .status,
    ).toBe(204);
    await eventually(
      async () =>
        (
          await call<Array<{ live: number }>>(
            a,
            "GET",
            "/v1/orgs/{org}/secrets",
          )
        ).body[0]!,
      (s) => s.live === 0,
    );
    const view = await runCase(a);
    expect(lookupOutput(view)).toMatchObject({
      authorization: "Bearer undefined",
      tokenLength: 0,
    });
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
        "secret.withdrawn",
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
