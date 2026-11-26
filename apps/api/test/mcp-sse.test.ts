import { orgId, withOrg, type OrgId } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { mcpServers } from "@preprocess/db/schema/mcp";
import { env } from "cloudflare:workers";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { mcpSession } from "../src/mcp.ts";
import { Client, createOrganization, signUp, testEnv } from "./helpers.ts";

let org: OrgId;
let client: Client;

const call = async <T = unknown>(
  method: string,
  path: string,
  body?: unknown,
) => {
  const response = await client.call<T>(path.replace("{org}", org), {
    method,
    ...(body !== undefined && { body }),
  });
  return { status: response.status, body: response.body };
};

// The fake server runs outside the Worker, so what it saw is read over HTTP.
const foreignRequests = async () =>
  (await fetch("https://crm.test/test/seen")).json<{ foreign: number }>();

// Counts the event streams the client opens and has not closed yet.
const watchStreams = () => {
  const streams = { open: 0 };
  const original = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const response = await original(input, init);
    if (!response.headers.get("content-type")?.includes("text/event-stream"))
      return response;
    const reader =
      response.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    streams.open++;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { value, done } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      async cancel(reason) {
        streams.open--;
        await reader.cancel(reason);
      },
    });
    return new Response(body, response);
  });
  return streams;
};

afterEach(() => {
  vi.restoreAllMocks();
});

type Server = { slug: string; url: string; transport: string };

beforeAll(async () => {
  const signedUp = await signUp("Vandelay");
  org = orgId(await createOrganization(signedUp.client, "Vandelay"));
  const created = await signedUp.client.call<{ key: string }>(
    "/api/auth/api-key/create",
    { body: { name: "admin", organizationId: org } },
  );
  client = new Client(testEnv(), {
    authorization: `Bearer ${created.body.key}`,
  });
});

describe("legacy HTTP+SSE MCP servers", () => {
  it("falls back to SSE when the server refuses streamable HTTP, and keeps using it", async () => {
    const streams = watchStreams();
    const registered = await call("PUT", "/v1/orgs/{org}/mcp-servers/orders", {
      url: "https://crm.test/sse",
    });
    expect(registered).toEqual({
      status: 200,
      body: { slug: "orders", auth: "none", transport: "sse" },
    });
    const { body: servers } = await call<Server[]>(
      "GET",
      "/v1/orgs/{org}/mcp-servers",
    );
    expect(servers.find((s) => s.slug === "orders")).toMatchObject({
      transport: "sse",
    });
    const tools = await call<Array<{ name: string }>>(
      "GET",
      "/v1/orgs/{org}/mcp-servers/orders/tools",
    );
    expect(tools.body.map((t) => t.name)).toEqual(["lookup_order"]);
    expect(streams.open).toBe(0);
  });

  it("refuses a message endpoint on another origin and sends it nothing", async () => {
    const registered = await call("PUT", "/v1/orgs/{org}/mcp-servers/foreign", {
      url: "https://crm.test/sse-foreign",
    });
    expect(registered.status).toBe(502);
    expect(JSON.stringify(registered.body)).toContain("another origin");
    expect((await foreignRequests()).foreign).toBe(0);
    const { body: servers } = await call<Server[]>(
      "GET",
      "/v1/orgs/{org}/mcp-servers",
    );
    expect(servers.map((s) => s.slug)).not.toContain("foreign");
  });

  it("gives up on a server that never answers and closes its stream", async () => {
    const streams = watchStreams();
    const failed = await mcpSession(
      "https://crm.test/sse-silent",
      "sse",
      undefined,
      (request) => request("tools/list", {}),
      300,
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(String(failed)).toContain("did not answer within");
    expect(streams.open).toBe(0);
  });
});

describe("https-only MCP URLs", () => {
  it("rejects an http: URL with a clear error", async () => {
    const registered = await call<{ error: { message: string } }>(
      "PUT",
      "/v1/orgs/{org}/mcp-servers/plain",
      { url: "http://crm.test/mcp" },
    );
    expect(registered.status).toBe(400);
    expect(registered.body.error.message).toContain(
      "MCP server URLs must be full https:// URLs",
    );
  });

  it("still lists a server stored with an http: URL before the rule", async () => {
    await withOrg(env, org, (tx) =>
      tx.insert(mcpServers).values({
        id: newId("mcpServer"),
        organizationId: org,
        slug: "older",
        url: "http://crm.test/mcp",
        auth: "oauth",
        createdBy: "test",
      }),
    );
    const { body: servers } = await call<Server[]>(
      "GET",
      "/v1/orgs/{org}/mcp-servers",
    );
    expect(servers.find((s) => s.slug === "older")).toMatchObject({
      url: "http://crm.test/mcp",
      transport: "streamable_http",
    });
  });
});
