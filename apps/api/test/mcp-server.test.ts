// The MCP server (src/mcp-server.ts): an organization API key only, one tool
// per listed API operation built from the OpenAPI document, and tool calls
// that go through the API's own checks.

import { orgId, withOrg } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { agents } from "@preprocess/db/schema/access";
import { beforeAll, describe, expect, it } from "vitest";

import { TOOLS } from "../src/mcp-server.ts";
import { Client, createOrganization, signUp, testEnv } from "./helpers.ts";

const environment = testEnv();

type Rpc<T = unknown> = {
  jsonrpc: "2.0";
  id: number | null;
  result?: T;
  error?: { code: number; message: string };
};
type ToolResult = {
  content: { type: string; text: string }[];
  isError: boolean;
};

let owner: Client;
let org: string;
let keyed: Client;
let otherOrg: string;
let id = 0;

const rpc = <T>(
  client: Client,
  method: string,
  params?: unknown,
  target = org,
) =>
  client.call<Rpc<T>>(`/v1/orgs/${target}/mcp`, {
    body: {
      jsonrpc: "2.0",
      id: ++id,
      method,
      ...(params !== undefined && { params }),
    },
  });

const callTool = async (name: string, args: Record<string, unknown> = {}) =>
  (await rpc<ToolResult>(keyed, "tools/call", { name, arguments: args })).body
    .result!;

beforeAll(async () => {
  const ana = await signUp("Ana", environment);
  owner = ana.client;
  org = await createOrganization(owner, "Acme");
  const key = await owner.call<{ key: string }>("/api/auth/api-key/create", {
    body: { name: "mcp", organizationId: org },
  });
  keyed = new Client(environment, { authorization: `Bearer ${key.body.key}` });
  await withOrg(environment, orgId(org), (tx) =>
    tx
      .insert(agents)
      .values({ id: newId("agent"), organizationId: org, slug: "intake" }),
  );
  otherOrg = await createOrganization(owner, "Globex");
});

describe("the MCP server", () => {
  it("takes only an organization API key", async () => {
    const session = await rpc(owner, "tools/list");
    expect(session.status).toBe(401);
    const elsewhere = await rpc(keyed, "tools/list", undefined, otherOrg);
    expect(elsewhere.status).toBe(403);
  });

  it("initializes with a protocol version it speaks", async () => {
    const init = await rpc<{ protocolVersion: string; capabilities: unknown }>(
      keyed,
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      },
    );
    expect(init.body.result).toMatchObject({
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
    });
    const note = await keyed.call(`/v1/orgs/${org}/mcp`, {
      body: { jsonrpc: "2.0", method: "notifications/initialized" },
    });
    expect(note.status).toBe(202);
    expect((await rpc(keyed, "resources/list")).body.error?.code).toBe(-32601);
  });

  it("lists one tool per listed operation, with inline schemas and no person-only decisions", async () => {
    const list = await rpc<{
      tools: {
        name: string;
        inputSchema: unknown;
        annotations: { readOnlyHint: boolean; destructiveHint: boolean };
      }[];
    }>(keyed, "tools/list");
    const tools = list.body.result!.tools;
    expect(tools.map((t) => t.name).sort()).toEqual(Object.keys(TOOLS).sort());
    expect(JSON.stringify(tools)).not.toContain("$ref");
    expect(
      tools.find((t) => t.name === "list_cases")!.annotations.readOnlyHint,
    ).toBe(true);
    expect(
      tools.find((t) => t.name === "cancel_case")!.annotations.destructiveHint,
    ).toBe(true);
    for (const path of Object.values(TOOLS).map((t) => t.path))
      expect(path).not.toMatch(
        /approvals|\/memories\/\{memory\}\/|guardrail-requests\/|secrets|groups|webhooks/,
      );
    const create = tools.find((t) => t.name === "create_case")!;
    expect(create.inputSchema).toMatchObject({
      type: "object",
      required: expect.arrayContaining(["agent"]),
    });
  });

  it("calls the API with the key's rights", async () => {
    const agentsList = await callTool("list_agents");
    expect(agentsList.isError).toBe(false);
    expect(agentsList.content[0]!.text).toContain("intake");
    const missing = await callTool("get_agent", {});
    expect(missing).toMatchObject({
      isError: true,
      content: [{ text: "Missing agent." }],
    });
    const unknown = await callTool("get_agent", { agent: "nope" });
    expect(unknown.isError).toBe(true);
    const memories = await callTool("list_agent_memories", { agent: "intake" });
    expect(JSON.parse(memories.content[0]!.text)).toMatchObject({
      memories: [],
      cap: 100,
    });
    const noSuchTool = await rpc(keyed, "tools/call", {
      name: "approve",
      arguments: {},
    });
    expect(noSuchTool.body.error?.code).toBe(-32602);
  });
});
