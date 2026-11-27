import { env, exports } from "cloudflare:workers";
import { readAuditEvents } from "@preprocess/db/audit";
import { orgId, withOrg, type OrgId } from "@preprocess/db/client";
import { beforeAll, describe, expect, it } from "vitest";

import { Client, createOrganization, signUp, testEnv } from "./helpers.ts";
// Bundled by vitest.config.ts, as `preprocess deploy` bundles an agent.
import crmAgent from "./dist/crm-agent.js?raw";

type Who = { org: OrgId; client: Client };
const seedOrg = async (name: string): Promise<Who> => {
  const { client } = await signUp(name);
  const org = orgId(await createOrganization(client, name));
  const created = await client.call<{ key: string }>(
    "/api/auth/api-key/create",
    { body: { name: "deploy", organizationId: org } },
  );
  return {
    org,
    client: new Client(testEnv(), {
      authorization: `Bearer ${created.body.key}`,
    }),
  };
};

const call = async <T = unknown>(
  who: Who,
  method: string,
  path: string,
  body?: unknown,
) => {
  const response = await who.client.call<T>(path.replace("{org}", who.org), {
    method,
    ...(body !== undefined && { body }),
  });
  return { status: response.status, body: response.body };
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

type Deployment = {
  id: string;
  agentId: string;
  status: string;
  waitingFor: { secrets?: string[]; mcp?: string[] };
};
type CaseView = {
  status: string;
  capture: Array<{
    kind: string;
    data: { output?: unknown; isError?: boolean };
  }>;
};
type Server = {
  slug: string;
  auth: string;
  agents: string[];
  connection: { status: string } | null;
};

const runCase = async (who: Who) => {
  const started = await call<{ id: string }>(
    who,
    "POST",
    "/v1/orgs/{org}/cases",
    { agent: "crm-agent", text: "Check stock for SKU A1." },
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
  const view = await eventually(
    () =>
      (testEnv().RUNTIME.getCase(key) as Promise<CaseView>).catch(
        () => ({ status: "queued" }) as CaseView,
      ),
    (v) => v.status === "completed" || v.status === "failed",
  );
  return {
    view,
    result: view.capture.find((e) => e.kind === "tool.result")!.data,
  };
};

let a: Who;
let b: Who;
let deployment: Deployment;

beforeAll(async () => {
  a = await seedOrg("Initech");
  b = await seedOrg("Hooli");
});

describe("MCP servers and the organization's connection", () => {
  it("registers a server and finds that it wants an OAuth sign-in", async () => {
    const registered = await call(a, "PUT", "/v1/orgs/{org}/mcp-servers/crm", {
      url: "https://crm.test/mcp",
    });
    expect(registered.body).toEqual({
      slug: "crm",
      auth: "oauth",
      transport: "streamable_http",
    });
  });

  it("holds a deployment that uses an ungranted server until it is granted", async () => {
    const deployed = await call<Deployment>(
      a,
      "POST",
      "/v1/orgs/{org}/agents/crm-agent/deployments",
      {
        bundle: { mainModule: "agent.js", modules: { "agent.js": crmAgent } },
        git: { branch: "main" },
      },
    );
    deployment = deployed.body;
    expect(deployment).toMatchObject({
      status: "waiting",
      waitingFor: { mcp: ["crm"] },
    });
    expect(
      (await call(a, "PUT", "/v1/orgs/{org}/mcp-servers/crm/agents/crm-agent"))
        .status,
    ).toBe(204);
    await eventually(
      async () =>
        (
          await call<Deployment>(
            a,
            "GET",
            `/v1/orgs/{org}/agents/crm-agent/deployments/${deployment.id}`,
          )
        ).body,
      (d) => d.status === "ready",
    );
    const promoted = await call(
      a,
      "POST",
      `/v1/orgs/{org}/agents/crm-agent/deployments/${deployment.id}/promote`,
    );
    expect(promoted.status).toBe(200);
  });

  it("tells the agent's code when the organization has not connected yet", async () => {
    const { result } = await runCase(a);
    expect(result).toMatchObject({ isError: true });
    expect(String(result.output)).toContain("not connected");
  });

  it("connects the organization through OAuth with PKCE", async () => {
    const started = await call<{ authorizationUrl: string }>(
      a,
      "POST",
      "/v1/orgs/{org}/mcp-servers/crm/connect",
    );
    const authorize = new URL(started.body.authorizationUrl);
    expect(authorize.origin).toBe("https://crm.test");
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    const consent = await fetch(authorize, { redirect: "manual" });
    const back = new URL(consent.headers.get("location")!);
    expect(back.pathname).toBe("/v1/mcp/oauth/callback");
    const finished = await new Client(testEnv()).call(
      back.pathname + back.search,
    );
    expect(finished.status).toBe(303);
    const landed = new URL(finished.headers.get("location")!);
    expect(landed.origin).toBe(new URL(testEnv().APP_URL).origin);
    expect(landed.pathname).toBe("/developers/integrations");
    expect(landed.searchParams.get("connected")).toBe("crm");
    const [server] = (
      await call<Server[]>(a, "GET", "/v1/orgs/{org}/mcp-servers")
    ).body;
    expect(server).toMatchObject({
      slug: "crm",
      auth: "oauth",
      agents: ["crm-agent"],
      connection: { status: "active" },
    });
    expect(JSON.stringify(server)).not.toMatch(/at-|rt-/);
    const tools = await call<Array<{ name: string }>>(
      a,
      "GET",
      "/v1/orgs/{org}/mcp-servers/crm/tools",
    );
    expect(tools.body.map((t) => t.name)).toEqual(["search_contacts"]);
  });

  it("refuses a sign-in callback it did not start", async () => {
    const forged = await new Client(testEnv()).call(
      `/v1/mcp/oauth/callback?code=x&state=${a.org}.mca_forged`,
    );
    expect(forged.status).toBe(303);
    const landed = new URL(forged.headers.get("location")!);
    expect(landed.pathname).toBe("/developers/integrations");
    expect(landed.searchParams.get("connect_error")).toBe("expired");
    expect(landed.searchParams.has("connected")).toBe(false);
  });

  it("sends the browser back when the person cancels the sign-in", async () => {
    const cancelled = await new Client(testEnv()).call(
      `/v1/mcp/oauth/callback?error=access_denied&state=${a.org}.mca_any`,
    );
    expect(cancelled.status).toBe(303);
    expect(
      new URL(cancelled.headers.get("location")!).searchParams.get(
        "connect_error",
      ),
    ).toBe("cancelled");
  });

  it("calls the server for the agent's code with a token the code never sees", async () => {
    const { view, result } = await runCase(a);
    expect(view.status).toBe("completed");
    expect(result).toMatchObject({
      isError: false,
      output: {
        content: [{ type: "text", text: "Ada Lovelace, buyer (Acme buyer)" }],
      },
    });
    expect(JSON.stringify(view)).not.toMatch(/at-|rt-/);
  });

  it("refreshes an expired token and retries", async () => {
    await fetch("https://crm.test/test/expire", { method: "POST" });
    const { result } = await runCase(a);
    expect(result).toMatchObject({ isError: false });
  });

  it("keeps the server from an agent once its grant is revoked", async () => {
    expect(
      (
        await call(
          a,
          "DELETE",
          "/v1/orgs/{org}/mcp-servers/crm/agents/crm-agent",
        )
      ).status,
    ).toBe(204);
    // The deployment waits for the grant again before the revoke returns,
    // so no new case starts on it.
    expect(
      (
        await call<Deployment>(
          a,
          "GET",
          `/v1/orgs/{org}/agents/crm-agent/deployments/${deployment.id}`,
        )
      ).body,
    ).toMatchObject({ status: "waiting", waitingFor: { mcp: ["crm"] } });
    expect(
      (
        await call(a, "POST", "/v1/orgs/{org}/cases", {
          agent: "crm-agent",
          text: "Check stock for SKU A1.",
        })
      ).status,
    ).toBe(409);
    // A case already running gets nothing from the token service either.
    const mcp = (
      exports as unknown as {
        McpService: {
          call(
            props: object,
            server: string,
            tool: string,
            args: unknown,
          ): Promise<unknown>;
        };
      }
    ).McpService;
    const refused = await mcp
      .call(
        {
          organizationId: a.org,
          agentId: deployment.agentId,
          deploymentId: deployment.id,
        },
        "crm",
        "search_contacts",
        { q: "acme" },
      )
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(String(refused)).toContain("not granted");
  });

  it("audits the connection without its tokens", async () => {
    const events = await withOrg(env, a.org, (tx) =>
      readAuditEvents(tx, a.org),
    );
    expect(events.map((e) => e.action)).toEqual(
      expect.arrayContaining([
        "mcp_server.created",
        "mcp_server.granted",
        "mcp_connection.connected",
        "mcp_server.revoked",
      ]),
    );
    expect(JSON.stringify(events)).not.toMatch(/at-[0-9a-f]|rt-[0-9a-f]/);
  });
});

describe("tenant isolation", () => {
  it("keeps one organization's servers and connections from another", async () => {
    expect(
      (await call<Server[]>(b, "GET", "/v1/orgs/{org}/mcp-servers")).body,
    ).toEqual([]);
    expect(
      (await call(b, "POST", "/v1/orgs/{org}/mcp-servers/crm/connect")).status,
    ).toBe(404);
    expect(
      (await call(b, "GET", "/v1/orgs/{org}/mcp-servers/crm/tools")).status,
    ).toBe(404);
    const other = await b.client.call(`/v1/orgs/${a.org}/mcp-servers`);
    expect(other.status).toBe(403);
  });
});
