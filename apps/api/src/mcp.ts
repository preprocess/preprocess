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

// `status` is set when the server refused the HTTP request itself, which is
// what registration reads to fall back from one transport to the other.
export class McpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export type McpTransport = "streamable_http" | "sse";

const PROTOCOL_VERSION = "2025-06-18";
// The last version the HTTP+SSE transport was specified for.
const SSE_PROTOCOL_VERSION = "2024-11-05";

// Every session, its streams included, closes by then.
export const MCP_DEADLINE_MS = 60_000;

type RpcResponse = {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
};

export type McpRequest = (method: string, params: object) => Promise<unknown>;

export class Unauthorized extends Error {
  constructor(readonly resourceMetadata: string | undefined) {
    super("unauthorized");
  }
}

const refused = async (response: Response) => {
  if (response.status === 401) {
    await response.body?.cancel();
    const header = response.headers.get("www-authenticate") ?? "";
    throw new Unauthorized(/resource_metadata="([^"]+)"/.exec(header)?.[1]);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new McpError(
      `the MCP server answered ${response.status}`,
      response.status,
    );
  }
};

const rpcResult = (message: RpcResponse | undefined) => {
  if (!message) throw new McpError("the MCP server sent no response");
  if (message.error) throw new McpError(message.error.message);
  return message.result;
};

const initializeParams = (protocolVersion: string) => ({
  protocolVersion,
  capabilities: {},
  clientInfo: { name: "preprocess", version: "1" },
});

// ---------------------------------------------------------------------------
// Streamable HTTP: every message is a POST; the reply is JSON or SSE.

const readRpc = async (response: Response, id: number) => {
  const type = response.headers.get("content-type") ?? "";
  const text = await response.text();
  const messages: RpcResponse[] = type.includes("text/event-stream")
    ? text
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => JSON.parse(line.slice(5)) as RpcResponse)
    : [JSON.parse(text) as RpcResponse];
  return rpcResult(messages.find((m) => m.id === id));
};

const streamableSession = async (
  url: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<McpRequest> => {
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
      signal,
    });
    await refused(response);
    session ??= response.headers.get("mcp-session-id");
    return response;
  };
  const request = async (method: string, params: object) => {
    const id = ++next;
    return readRpc(await post({ id, method, params }), id);
  };
  await request("initialize", initializeParams(PROTOCOL_VERSION));
  await (await post({ method: "notifications/initialized" })).body?.cancel();
  return request;
};

// ---------------------------------------------------------------------------
// HTTP+SSE (deprecated in MCP 2025-03-26), a fallback for servers that only
// speak it: a GET opens an event stream, its `endpoint` event names where to
// POST messages, and replies come back on the stream.

type SseEvent = { event: string; data: string };

async function* sseEvents(
  reader: ReadableStreamDefaultReader<string>,
): AsyncGenerator<SseEvent> {
  let buffer = "";
  let event = "message";
  let data: string[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += value;
      const lines = buffer.split(/\r\n|\r|\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line === "") {
          if (data.length) yield { event, data: data.join("\n") };
          event = "message";
          data = [];
        } else if (line.startsWith(":")) continue;
        else {
          const colon = line.indexOf(":");
          const field = colon === -1 ? line : line.slice(0, colon);
          const raw = colon === -1 ? "" : line.slice(colon + 1);
          const text = raw.startsWith(" ") ? raw.slice(1) : raw;
          if (field === "event") event = text;
          else if (field === "data") data.push(text);
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

const sseSession = async (
  url: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<McpRequest> => {
  const auth = token ? { authorization: `Bearer ${token}` } : {};
  const stream = await fetch(url, {
    headers: { accept: "text/event-stream", ...auth },
    signal,
  });
  await refused(stream);
  if (
    !stream.body ||
    !stream.headers.get("content-type")?.includes("text/event-stream")
  ) {
    await stream.body?.cancel();
    throw new McpError(
      "the MCP server did not open an event stream",
      stream.status,
    );
  }
  const reader = stream.body.pipeThrough(new TextDecoderStream()).getReader();
  signal.addEventListener("abort", () => void reader.cancel().catch(() => {}));
  const events = sseEvents(reader);
  const nextEvent = async () => {
    const next = await events.next().catch((error: unknown) => {
      throw signal.aborted ? signal.reason : error;
    });
    if (signal.aborted) throw signal.reason;
    if (next.done) throw new McpError("the MCP server closed its event stream");
    return next.value;
  };

  let first = await nextEvent();
  while (first.event !== "endpoint") first = await nextEvent();
  const endpoint = new URL(first.data.trim(), url);
  // The server picks where messages go; the organization's token only ever
  // goes to the origin an admin registered.
  if (endpoint.origin !== new URL(url).origin)
    throw new McpError(
      "the MCP server named a message endpoint on another origin",
    );

  let next = 0;
  const post = async (body: object) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ jsonrpc: "2.0", ...body }),
      signal,
    });
    await refused(response);
    await response.body?.cancel();
  };
  const request = async (method: string, params: object) => {
    const id = ++next;
    await post({ id, method, params });
    for (;;) {
      const event = await nextEvent();
      if (event.event !== "message") continue;
      const message = JSON.parse(event.data) as RpcResponse;
      if (message.id === id) return rpcResult(message);
    }
  };
  await request("initialize", initializeParams(SSE_PROTOCOL_VERSION));
  await post({ method: "notifications/initialized" });
  return request;
};

// One session for one piece of work. The deadline covers connecting and the
// work, and the session's requests and streams are closed when it ends.
export const mcpSession = async <T>(
  url: string,
  transport: McpTransport,
  token: string | undefined,
  work: (request: McpRequest) => Promise<T>,
  deadlineMs = MCP_DEADLINE_MS,
) => {
  const controller = new AbortController();
  let expire: (error: McpError) => void = () => {};
  const deadline = new Promise<never>((_, reject) => (expire = reject));
  const timer = setTimeout(() => {
    const error = new McpError(
      `the MCP server did not answer within ${deadlineMs / 1000} seconds`,
    );
    controller.abort(error);
    expire(error);
  }, deadlineMs);
  try {
    const open = transport === "sse" ? sseSession : streamableSession;
    return await Promise.race([
      open(url, token, controller.signal).then(work),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
};

// Registration's probe, without a token: streamable HTTP first, then the
// legacy transport when the server refuses the POST the way an SSE-only
// server does (MCP's backwards-compatibility rule). Unauthorized means the
// transport works and the server wants an OAuth sign-in.
export const detectServer = async (url: string) => {
  const probe = (transport: McpTransport) =>
    mcpSession(url, transport, undefined, async () => {}).then(
      () => ({ transport, auth: "none" as const }),
      (error: unknown) => {
        if (error instanceof Unauthorized)
          return { transport, auth: "oauth" as const };
        throw error;
      },
    );
  try {
    return await probe("streamable_http");
  } catch (error) {
    if (
      !(error instanceof McpError) ||
      ![400, 404, 405].includes(error.status ?? 0)
    )
      throw error;
    // When the server doesn't speak SSE either, the first answer says more.
    return probe("sse").catch((sseError: unknown) => {
      throw sseError instanceof McpError && sseError.status !== undefined
        ? error
        : sseError;
    });
  }
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
  work: (request: McpRequest) => Promise<T>,
) => {
  const token = await accessToken(env, org, server);
  try {
    return await mcpSession(server.url, server.transport, token, work);
  } catch (error) {
    if (!(error instanceof Unauthorized) || server.auth === "none") throw error;
    return mcpSession(
      server.url,
      server.transport,
      await refreshConnection(env, org, server),
      work,
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
