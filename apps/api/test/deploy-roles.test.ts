// Who may deploy, promote and roll back (spec 2: Developers deploy). Owners,
// Admins, the Developers group and organization API keys (which act as Admin,
// as the deploy Action and the MCP server use them) may; any other Member may
// not, and each refusal is audited.

import { beforeAll, describe, expect, it } from "vitest";

import {
  addMember,
  Client,
  createOrganization,
  signUp,
  testEnv,
} from "./helpers.ts";
// Bundled by vitest.config.ts, as `preprocess deploy` bundles an agent. It
// asks for no secret, group or connection, so production deploys go live.
import scheduledAgent from "./dist/scheduled-agent.js?raw";

type Deployment = { id: string };
type AuditEvent = {
  action: string;
  actorId: string;
  data: Record<string, unknown>;
};

let org: string;
let owner: Client;
let admin: Client;
let developer: Client;
let member: Client;
let memberId: string;
let key: Client;

const deploy = (who: Client, agent: string, commit: string) =>
  who.call<Deployment>(`/v1/orgs/${org}/agents/${agent}/deployments`, {
    body: {
      bundle: {
        mainModule: "agent.js",
        modules: { "agent.js": scheduledAgent },
      },
      git: { branch: "main", commit },
    },
  });

const promote = (who: Client, agent: string, deployment: string) =>
  who.call<Deployment>(
    `/v1/orgs/${org}/agents/${agent}/deployments/${deployment}/promote`,
    { method: "POST" },
  );

const production = async (agent: string) =>
  (
    await owner.call<{ productionDeploymentId: string | null }>(
      `/v1/orgs/${org}/agents/${agent}`,
    )
  ).body.productionDeploymentId;

beforeAll(async () => {
  owner = (await signUp("Rhea Owner")).client;
  org = await createOrganization(owner, "Roleco");
  admin = (await addMember(owner, org, "Ada Admin", "admin")).client;
  const dev = await addMember(owner, org, "Dev Eloper");
  developer = dev.client;
  const plain = await addMember(owner, org, "Mo Member");
  member = plain.client;
  memberId = plain.userId;

  const groups = await owner.call<{ id: string; isDevelopers: boolean }[]>(
    `/v1/orgs/${org}/groups`,
  );
  const developers = groups.body.find((g) => g.isDevelopers)!;
  await owner.call(
    `/v1/orgs/${org}/groups/${developers.id}/members/${dev.userId}`,
    { method: "PUT" },
  );
  // Belonging to another group grants nothing here.
  const legal = await owner.call<{ id: string }>(`/v1/orgs/${org}/groups`, {
    body: { name: "Legal" },
  });
  await owner.call(
    `/v1/orgs/${org}/groups/${legal.body.id}/members/${plain.userId}`,
    { method: "PUT" },
  );

  const created = await owner.call<{ key: string }>(
    "/api/auth/api-key/create",
    { body: { name: "deploy", organizationId: org } },
  );
  key = new Client(testEnv(), {
    authorization: `Bearer ${created.body.key}`,
  });
});

describe("deploy, promote and roll back", () => {
  it.each([
    ["an Owner", "owner", () => owner],
    ["an Admin", "admin", () => admin],
    ["a member of the Developers group", "developer", () => developer],
    ["an organization API key", "key", () => key],
  ])("are allowed for %s", async (_, slug, who) => {
    const agent = `allowed-${slug}`;
    const first = await deploy(who(), agent, "aaa1111");
    expect(first.status).toBe(201);
    const second = await deploy(who(), agent, "bbb2222");
    expect(second.status).toBe(201);
    expect(await production(agent)).toBe(second.body.id);

    // Promoting the earlier deployment is the rollback.
    expect((await promote(who(), agent, first.body.id)).status).toBe(200);
    expect(await production(agent)).toBe(first.body.id);
    expect((await promote(who(), agent, second.body.id)).status).toBe(200);
    expect(await production(agent)).toBe(second.body.id);
  });

  it("are refused for a Member outside the Developers group, and audited", async () => {
    expect((await deploy(member, "refused", "ccc3333")).status).toBe(403);
    // The refused deploy did not create the agent.
    expect((await owner.call(`/v1/orgs/${org}/agents/refused`)).status).toBe(
      404,
    );

    const first = await deploy(key, "guarded", "ddd4444");
    const second = await deploy(key, "guarded", "eee5555");
    expect((await promote(member, "guarded", first.body.id)).status).toBe(403);
    expect((await promote(member, "guarded", second.body.id)).status).toBe(403);
    expect(await production("guarded")).toBe(second.body.id);

    const events = await owner.call<{ events: AuditEvent[] }>(
      `/v1/orgs/${org}/audit-events?limit=500`,
    );
    expect(
      events.body.events
        .filter((e) => e.action === "deployment.denied")
        .map((e) => ({ actor: e.actorId, ...e.data })),
    ).toEqual([
      { actor: memberId, agent: "refused", operation: "deploy" },
      { actor: memberId, agent: "guarded", operation: "promote" },
      { actor: memberId, agent: "guarded", operation: "promote" },
    ]);
  });

  it("are allowed through the MCP server's promote tool with an API key", async () => {
    const first = await deploy(key, "mcp-roles", "fff6666");
    await deploy(key, "mcp-roles", "aab7777");
    const answer = await key.call<{ result?: { isError?: boolean } }>(
      `/v1/orgs/${org}/mcp`,
      {
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "promote_deployment",
            arguments: { agent: "mcp-roles", deployment: first.body.id },
          },
        },
      },
    );
    expect(answer.body.result?.isError).toBeFalsy();
    expect(await production("mcp-roles")).toBe(first.body.id);
  });
});
