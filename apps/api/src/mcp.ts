// The MCP token service (design doc 03). Agent code reaches the
// organization's MCP servers only through an `MCP` capability the runtime
// passes with each dispatch, whose props name the organization, agent and
// deployment. The service checks the deployment declares the server and the agent is granted
// it, adds the organization's token (refreshing it when it expires), and
// calls the server. Tokens never leave this Worker.

import { WorkerEntrypoint } from "cloudflare:workers";
import type { OrgId, Tx } from "@preprocess/db/client";
import { orgId, withOrg } from "@preprocess/db/client";
import { audit } from "@preprocess/db/audit";
import { newId } from "@preprocess/db/ids";
import { deployments } from "@preprocess/db/schema/deployments";
import {
  mcpConnections,
  mcpGrants,
  mcpServers,
  type McpOAuthClient,
} from "@preprocess/db/schema/mcp";
import { and, eq, sql } from "drizzle-orm";

import { decrypt, encrypt, orgKey, orgKeyVersion } from "./crypto.ts";
import type { Env } from "./env.ts";

export type McpProps = {
  organizationId: string;
  agentId: string;
  deploymentId: string;
};

type Tokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
};

export class McpError extends Error {}

const PROTOCOL_VERSION = "2025-06-18";

// ---------------------------------------------------------------------------
// Streamable HTTP client: one session per call, JSON or SSE responses.

type RpcResponse = {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
};

export class Unauthorized extends Error {
  constructor(readonly resourceMetadata: string | undefined) {
    super("unauthorized");
  }
}

const readRpc = async (response: Response, id: number) => {
  const type = response.headers.get("content-type") ?? "";
  const text = await response.text();
  const messages: RpcResponse[] = type.includes("text/event-stream")
    ? text
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => JSON.parse(line.slice(5)) as RpcResponse)
    : [JSON.parse(text) as RpcResponse];
  const message = messages.find((m) => m.id === id);
  if (!message) throw new McpError("the MCP server sent no response");
  if (message.error) throw new McpError(message.error.message);
  return message.result;
};

export const mcpSession = async (url: string, token?: string) => {
  let session: string | null = null;
  let next = 0;
  const post = async (body: object) => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": PROTOCOL_VERSION,
        ...(token && { authorization: `Bearer ${token}` }),
        ...(session && { "mcp-session-id": session }),
      },
      body: JSON.stringify({ jsonrpc: "2.0", ...body }),
    });
    if (response.status === 401) {
      const header = response.headers.get("www-authenticate") ?? "";
      throw new Unauthorized(/resource_metadata="([^"]+)"/.exec(header)?.[1]);
    }
    if (!response.ok)
      throw new McpError(`the MCP server answered ${response.status}`);
    session ??= response.headers.get("mcp-session-id");
    return response;
  };
  const request = async (method: string, params: object) => {
    const id = ++next;
    return readRpc(await post({ id, method, params }), id);
  };
  await request("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "preprocess", version: "1" },
  });
  await (await post({ method: "notifications/initialized" })).body?.cancel();
  return request;
};

// ---------------------------------------------------------------------------
// OAuth for MCP (authorization code with PKCE, dynamic client registration).

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

export const pkce = async () => {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
  return { verifier, challenge };
};

const getJson = async <T>(url: string) => {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new McpError(`${url} answered ${response.status}`);
  return response.json<T>();
};

// Finds the server's authorization server and registers Preprocess with it.
export const registerClient = async (
  serverUrl: string,
  resourceMetadata: string | undefined,
  redirectUri: string,
): Promise<McpOAuthClient> => {
  const server = new URL(serverUrl);
  const resource = await getJson<{
    resource?: string;
    authorization_servers?: string[];
    scopes_supported?: string[];
  }>(
    resourceMetadata ?? `${server.origin}/.well-known/oauth-protected-resource`,
  );
  const issuer = resource.authorization_servers?.[0];
  if (!issuer)
    throw new McpError("the MCP server names no authorization server");
  const metadata = await getJson<{
    authorization_endpoint: string;
    token_endpoint: string;
    registration_endpoint?: string;
    scopes_supported?: string[];
  }>(`${new URL(issuer).origin}/.well-known/oauth-authorization-server`);
  if (!metadata.registration_endpoint)
    throw new McpError(
      "the authorization server does not support client registration",
    );
  const registered = await fetch(metadata.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Preprocess",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!registered.ok)
    throw new McpError(`client registration answered ${registered.status}`);
  const { client_id } = await registered.json<{ client_id: string }>();
  const scope = (resource.scopes_supported ?? metadata.scopes_supported)?.join(
    " ",
  );
  return {
    clientId: client_id,
    authorizationEndpoint: metadata.authorization_endpoint,
    tokenEndpoint: metadata.token_endpoint,
    resource: resource.resource ?? serverUrl,
    ...(scope && { scope }),
  };
};

export const tokenRequest = async (
  client: McpOAuthClient,
  params: Record<string, string>,
): Promise<Tokens> => {
  const response = await fetch(client.tokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams({
      ...params,
      client_id: client.clientId,
      resource: client.resource,
    }),
  });
  if (!response.ok)
    throw new McpError(`the token endpoint answered ${response.status}`);
  const body = await response.json<{
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  }>();
  return {
    accessToken: body.access_token,
    ...(body.refresh_token && { refreshToken: body.refresh_token }),
    ...(body.expires_in && { expiresAt: Date.now() + body.expires_in * 1000 }),
  };
};

// ---------------------------------------------------------------------------
// Connections: encrypted with the organization's key.

const aad = (org: string, id: string, version: number) =>
  `${org}|${id}|${version}`;

export const saveConnection = async (
  env: Env,
  tx: Tx,
  org: OrgId,
  serverId: string,
  tokens: Tokens,
  connectedBy: string,
) => {
  const [existing] = await tx
    .select({ id: mcpConnections.id, version: mcpConnections.version })
    .from(mcpConnections)
    .where(eq(mcpConnections.serverId, serverId));
  const id = existing?.id ?? newId("mcpConnection");
  const version = (existing?.version ?? 0) + 1;
  const { key, version: keyVersion } = await orgKey(env, tx, org);
  const ciphertext = await encrypt(
    key,
    JSON.stringify(tokens),
    aad(org, id, version),
  );
  await tx
    .insert(mcpConnections)
    .values({
      id,
      organizationId: org,
      serverId,
      version,
      keyVersion,
      ciphertext,
      status: "active",
      connectedBy,
    })
    .onConflictDoUpdate({
      target: mcpConnections.id,
      set: {
        version,
        keyVersion,
        ciphertext,
        status: "active",
        connectedBy,
        updatedAt: sql`now()`,
      },
    });
  return id;
};

const readTokens = async (
  env: Env,
  tx: Tx,
  org: OrgId,
  connection: typeof mcpConnections.$inferSelect,
) => {
  const key = await orgKeyVersion(env, tx, org, connection.keyVersion);
  return JSON.parse(
    await decrypt(
      key,
      connection.ciphertext,
      aad(org, connection.id, connection.version),
    ),
  ) as Tokens;
};

// Refreshes the organization's token for a server, or marks the connection
// as needing a new sign-in when the server refuses.
export const refreshConnection = async (
  env: Env,
  org: OrgId,
  server: typeof mcpServers.$inferSelect,
) =>
  withOrg(env, org, async (tx) => {
    const [connection] = await tx
      .select()
      .from(mcpConnections)
      .where(eq(mcpConnections.serverId, server.id))
      .for("update");
    if (!connection || connection.status !== "active" || !server.oauthClient)
      throw new McpError(`MCP server ${server.slug} is not connected`);
    const tokens = await readTokens(env, tx, org, connection);
    const refreshed = tokens.refreshToken
      ? await tokenRequest(server.oauthClient, {
          grant_type: "refresh_token",
          refresh_token: tokens.refreshToken,
        }).catch(() => null)
      : null;
    if (!refreshed) {
      await tx
        .update(mcpConnections)
        .set({ status: "needs_reauth", updatedAt: sql`now()` })
        .where(eq(mcpConnections.id, connection.id));
      await audit(tx, {
        organizationId: org,
        actorType: "platform",
        actorId: "mcp",
        action: "mcp_connection.needs_reauth",
        targetType: "mcp_server",
        targetId: server.id,
        data: { server: server.slug },
      });
      throw new McpError(
        `the connection to MCP server ${server.slug} needs a new sign-in`,
      );
    }
    await saveConnection(
      env,
      tx,
      org,
      server.id,
      { refreshToken: tokens.refreshToken, ...refreshed } as Tokens,
      connection.connectedBy,
    );
    return refreshed.accessToken;
  });

const accessToken = async (
  env: Env,
  org: OrgId,
  server: typeof mcpServers.$inferSelect,
) => {
  if (server.auth === "none") return undefined;
  const tokens = await withOrg(env, org, async (tx) => {
    const [connection] = await tx
      .select()
      .from(mcpConnections)
      .where(eq(mcpConnections.serverId, server.id));
    if (!connection || connection.status !== "active")
      throw new McpError(
        `MCP server ${server.slug} is ${connection ? "waiting for a new sign-in" : "not connected"}`,
      );
    return readTokens(env, tx, org, connection);
  });
  if (tokens.expiresAt && tokens.expiresAt < Date.now() + 60_000)
    return refreshConnection(env, org, server);
  return tokens.accessToken;
};

// One session with the organization's token, retried once after a refresh
// when the server says the token is no longer good.
export const withServer = async <T>(
  env: Env,
  org: OrgId,
  server: typeof mcpServers.$inferSelect,
  work: (request: Awaited<ReturnType<typeof mcpSession>>) => Promise<T>,
) => {
  const token = await accessToken(env, org, server);
  try {
    return await work(await mcpSession(server.url, token));
  } catch (error) {
    if (!(error instanceof Unauthorized) || server.auth === "none") throw error;
    return work(
      await mcpSession(server.url, await refreshConnection(env, org, server)),
    );
  }
};

export type McpTool = {
  name: string;
  description?: string;
  inputSchema: unknown;
};

export const listTools = (
  env: Env,
  org: OrgId,
  server: typeof mcpServers.$inferSelect,
) =>
  withServer(env, org, server, async (request) => {
    const result = (await request("tools/list", {})) as { tools: McpTool[] };
    return result.tools.map((t) => ({
      name: t.name,
      ...(t.description && { description: t.description }),
      inputSchema: t.inputSchema,
    }));
  });

// The server a deployment may use: declared in its code, registered by the
// organization, and granted to its agent (the guardrail).
const brokeredServer = async (env: Env, props: McpProps, slug: string) => {
  const org = orgId(props.organizationId);
  const server = await withOrg(env, org, async (tx) => {
    const [deployment] = await tx
      .select({ manifest: deployments.manifest })
      .from(deployments)
      .where(
        and(
          eq(deployments.id, props.deploymentId),
          eq(deployments.agentId, props.agentId),
        ),
      );
    if (!deployment) throw new McpError("unknown deployment");
    if (!(deployment.manifest as { mcp: string[] }).mcp.includes(slug))
      throw new McpError(`MCP server ${slug} is not declared by this agent`);
    const [row] = await tx
      .select({ server: mcpServers })
      .from(mcpServers)
      .innerJoin(
        mcpGrants,
        and(
          eq(mcpGrants.serverId, mcpServers.id),
          eq(mcpGrants.agentId, props.agentId),
        ),
      )
      .where(eq(mcpServers.slug, slug));
    if (!row)
      throw new McpError(`this agent is not granted MCP server ${slug}`);
    return row.server;
  });
  return { org, server };
};

const broker = {
  async listTools(env: Env, props: McpProps, slug: string) {
    const { org, server } = await brokeredServer(env, props, slug);
    return listTools(env, org, server);
  },
  async call(
    env: Env,
    props: McpProps,
    slug: string,
    tool: string,
    args: unknown,
  ) {
    const { org, server } = await brokeredServer(env, props, slug);
    return withServer(env, org, server, (request) =>
      request("tools/call", { name: tool, arguments: args ?? {} }),
    );
  },
};

// The token service itself. Only the runtime binds it: for each tool call
// the runtime hands the agent's code an McpBroker capability whose props fix
// the organization, agent and deployment, and that capability calls here.
export class McpService extends WorkerEntrypoint<Env> {
  listTools(props: McpProps, server: string) {
    return broker.listTools(this.env, props, server);
  }

  call(props: McpProps, server: string, tool: string, args: unknown) {
    return broker.call(this.env, props, server, tool, args);
  }
}
