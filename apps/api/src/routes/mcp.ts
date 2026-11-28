// MCP servers and their connections (mvp-surface "Source and MCP", design
// doc 03). The organization registers a server once and connects it once;
// every connection is the organization's. Which agents may use a server is a
// guardrail only an Admin or Owner loosens.

import { audit } from "@preprocess/db/audit";
import { orgId, withOrg } from "@preprocess/db/client";
import { newId } from "@preprocess/db/ids";
import { agents } from "@preprocess/db/schema/access";
import {
  mcpAuthorizations,
  mcpConnections,
  mcpGrants,
  mcpServers,
} from "@preprocess/db/schema/mcp";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import {
  actor,
  eventBase,
  requireAdmin,
  type OrgVariables,
} from "../caller.ts";
import type { Env } from "../env.ts";
import {
  listTools,
  detectServer,
  McpError,
  mcpSession,
  pkce,
  refreshConnection,
  registerClient,
  saveConnection,
  tokenRequest,
  Unauthorized,
} from "../mcp.ts";
import { AGENT_SLUG, syncAgents } from "../deploy.ts";

type Ctx = { Bindings: Env; Variables: OrgVariables };
export const mcpRoutes = new OpenAPIHono<Ctx>({
  defaultHook: (result, c) => {
    if (!result.success)
      return c.json(
        {
          error: {
            code: "invalid_request",
            message: result.error.issues
              .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
              .join("; "),
          },
        },
        400,
      );
  },
});

const Transport = z.enum(["streamable_http", "sse"]).openapi({
  description:
    "How Preprocess reaches the server, detected at registration: streamable HTTP, or the deprecated HTTP+SSE transport when the server only speaks that. Read-only.",
});

const McpServer = z
  .object({
    slug: z.string(),
    url: z.string(),
    auth: z.enum(["none", "oauth"]),
    transport: Transport,
    agents: z
      .array(z.string())
      .openapi({ description: "Slugs of the agents granted this server" }),
    connection: z
      .object({
        status: z.enum(["active", "needs_reauth", "revoked"]),
        connectedBy: z.string(),
        updatedAt: z.string(),
      })
      .nullable()
      .openapi({ description: "The organization's connection; never a token" }),
  })
  .openapi("McpServer");

const ServerParams = z.object({ org: z.string(), server: z.string() });
const GrantParams = ServerParams.extend({ agent: z.string() });

const callbackUrl = (env: Env) => `${env.APP_URL}/v1/mcp/oauth/callback`;

const mcpFailure = (error: unknown): never => {
  if (error instanceof McpError || error instanceof Unauthorized)
    throw new HTTPException(502, { message: error.message });
  throw error;
};

const findServer = async (env: Env, org: OrgVariables["org"], slug: string) => {
  const [server] = await withOrg(env, org, (tx) =>
    tx.select().from(mcpServers).where(eq(mcpServers.slug, slug)),
  );
  if (!server)
    throw new HTTPException(404, { message: "MCP server not found" });
  return server;
};

mcpRoutes.openapi(
  createRoute({
    method: "get",
    path: "/mcp-servers",
    tags: ["MCP servers"],
    summary: "List the organization's MCP servers and connection status",
    request: { params: z.object({ org: z.string() }) },
    responses: {
      200: {
        description: "Servers, their grants and connections",
        content: { "application/json": { schema: z.array(McpServer) } },
      },
    },
  }),
  async (c) => {
    const list = await withOrg(c.env, c.var.org, async (tx) => {
      const servers = await tx
        .select()
        .from(mcpServers)
        .orderBy(mcpServers.slug);
      const grants = await tx
        .select({ serverId: mcpGrants.serverId, slug: agents.slug })
        .from(mcpGrants)
        .innerJoin(agents, eq(agents.id, mcpGrants.agentId));
      const connections = await tx
        .select({
          serverId: mcpConnections.serverId,
          status: mcpConnections.status,
          connectedBy: mcpConnections.connectedBy,
          updatedAt: mcpConnections.updatedAt,
        })
        .from(mcpConnections);
      return servers.map((s) => {
        const connection = connections.find((x) => x.serverId === s.id);
        return {
          slug: s.slug,
          url: s.url,
          auth: s.auth,
          transport: s.transport,
          agents: grants.filter((g) => g.serverId === s.id).map((g) => g.slug),
          connection: connection
            ? {
                status: connection.status,
                connectedBy: connection.connectedBy,
                updatedAt: connection.updatedAt.toISOString(),
              }
            : null,
        };
      });
    });
    return c.json(list, 200);
  },
);

mcpRoutes.openapi(
  createRoute({
    method: "put",
    path: "/mcp-servers/{server}",
    tags: ["MCP servers"],
    summary:
      "Register a remote MCP server under the name agent code uses for it; a new URL drops the connection",
    request: {
      params: ServerParams,
      body: {
        content: {
          "application/json": {
            schema: z.object({
              url: z.url({
                protocol: /^https$/,
                error: "MCP server URLs must be full https:// URLs",
              }),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Registered",
        content: {
          "application/json": {
            schema: z.object({
              slug: z.string(),
              auth: z.enum(["none", "oauth"]),
              transport: Transport,
            }),
          },
        },
      },
    },
  }),
  async (c) => {
    requireAdmin(c.var.caller);
    const { server: slug } = c.req.valid("param");
    const { url } = c.req.valid("json");
    if (!AGENT_SLUG.test(slug))
      throw new HTTPException(400, {
        message: `MCP server names must match ${AGENT_SLUG}`,
      });
    // A server that refuses an unauthenticated session wants an OAuth
    // sign-in; one that accepts it needs no connection.
    const { auth, transport } = await detectServer(url).catch(mcpFailure);
    await withOrg(c.env, c.var.org, async (tx) => {
      const [existing] = await tx
        .select()
        .from(mcpServers)
        .where(eq(mcpServers.slug, slug));
      if (
        existing?.url === url &&
        existing.auth === auth &&
        existing.transport === transport
      )
        return;
      const id = existing?.id ?? newId("mcpServer");
      if (existing) {
        await tx
          .update(mcpServers)
          .set({ url, auth, transport, oauthClient: null })
          .where(eq(mcpServers.id, id));
        await tx.delete(mcpConnections).where(eq(mcpConnections.serverId, id));
      } else
        await tx.insert(mcpServers).values({
          id,
          organizationId: c.var.org,
          slug,
          url,
          auth,
          transport,
          createdBy: actor(c.var.caller).actorId,
        });
      await audit(tx, {
        ...eventBase(c.var),
        action: existing ? "mcp_server.updated" : "mcp_server.created",
        targetType: "mcp_server",
        targetId: id,
        data: { server: slug, url, auth, transport },
      });
    });
    return c.json({ slug, auth, transport }, 200);
  },
);

mcpRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/mcp-servers/{server}",
    tags: ["MCP servers"],
    summary:
      "Remove an MCP server and its connection; refused while agents are granted it",
    request: { params: ServerParams },
    responses: { 204: { description: "Removed" } },
  }),
  async (c) => {
    requireAdmin(c.var.caller);
    const server = await findServer(
      c.env,
      c.var.org,
      c.req.valid("param").server,
    );
    await withOrg(c.env, c.var.org, async (tx) => {
      const granted = await tx
        .select({ slug: agents.slug })
        .from(mcpGrants)
        .innerJoin(agents, eq(agents.id, mcpGrants.agentId))
        .where(eq(mcpGrants.serverId, server.id));
      if (granted.length)
        throw new HTTPException(409, {
          message: `agents are granted this server: ${granted.map((g) => g.slug).join(", ")}`,
        });
      await tx.delete(mcpServers).where(eq(mcpServers.id, server.id));
      await audit(tx, {
        ...eventBase(c.var),
        action: "mcp_server.deleted",
        targetType: "mcp_server",
        targetId: server.id,
        data: { server: server.slug },
      });
    });
    return c.body(null, 204);
  },
);

const grantChange =
  (grant: boolean) =>
  async (c: Parameters<Parameters<typeof mcpRoutes.openapi>[1]>[0]) => {
    requireAdmin(c.var.caller);
    const { server: slug, agent: agentSlug } = c.req.param() as z.infer<
      typeof GrantParams
    >;
    await withOrg(c.env, c.var.org, async (tx) => {
      const [server] = await tx
        .select()
        .from(mcpServers)
        .where(eq(mcpServers.slug, slug));
      const [agent] = await tx
        .select()
        .from(agents)
        .where(eq(agents.slug, agentSlug));
      if (!server || !agent)
        throw new HTTPException(404, {
          message: "MCP server or agent not found",
        });
      if (grant)
        await tx
          .insert(mcpGrants)
          .values({
            organizationId: c.var.org,
            serverId: server.id,
            agentId: agent.id,
            grantedBy: actor(c.var.caller).actorId,
          })
          .onConflictDoNothing();
      else
        await tx
          .delete(mcpGrants)
          .where(
            and(
              eq(mcpGrants.serverId, server.id),
              eq(mcpGrants.agentId, agent.id),
            ),
          );
      await audit(tx, {
        ...eventBase(c.var),
        action: grant ? "mcp_server.granted" : "mcp_server.revoked",
        targetType: "mcp_server",
        targetId: server.id,
        data: { server: slug, agent: agent.id },
      });
      // Live deployments recompute what they wait for.
      await syncAgents(tx, c.var.org, [agent.id]);
    });
    return c.body(null, 204);
  };

mcpRoutes.openapi(
  createRoute({
    method: "put",
    path: "/mcp-servers/{server}/agents/{agent}",
    tags: ["MCP servers"],
    summary:
      "Let an agent's code use this MCP server (loosens a guardrail; Admin or Owner)",
    request: { params: GrantParams },
    responses: { 204: { description: "Granted" } },
  }),
  grantChange(true),
);

mcpRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/mcp-servers/{server}/agents/{agent}",
    tags: ["MCP servers"],
    summary: "Stop an agent's code using this MCP server",
    request: { params: GrantParams },
    responses: { 204: { description: "Revoked" } },
  }),
  grantChange(false),
);

mcpRoutes.openapi(
  createRoute({
    method: "post",
    path: "/mcp-servers/{server}/connect",
    tags: ["MCP servers"],
    summary:
      "Start the organization's OAuth sign-in to an MCP server; open the returned URL in a browser",
    request: { params: ServerParams },
    responses: {
      200: {
        description: "Where to sign in",
        content: {
          "application/json": {
            schema: z.object({ authorizationUrl: z.string() }),
          },
        },
      },
    },
  }),
  async (c) => {
    requireAdmin(c.var.caller);
    const server = await findServer(
      c.env,
      c.var.org,
      c.req.valid("param").server,
    );
    if (server.auth !== "oauth")
      throw new HTTPException(409, {
        message: "this MCP server needs no sign-in",
      });
    const redirectUri = callbackUrl(c.env);
    let client = server.oauthClient;
    if (!client) {
      const resourceMetadata = await mcpSession(
        server.url,
        server.transport,
        undefined,
        () => Promise.resolve(undefined),
      ).catch((error: unknown) =>
        error instanceof Unauthorized
          ? error.resourceMetadata
          : mcpFailure(error),
      );
      client = await registerClient(
        server.url,
        resourceMetadata,
        redirectUri,
      ).catch(mcpFailure);
      const registered = client;
      await withOrg(c.env, c.var.org, (tx) =>
        tx
          .update(mcpServers)
          .set({ oauthClient: registered })
          .where(eq(mcpServers.id, server.id)),
      );
    }
    const { verifier, challenge } = await pkce();
    const id = newId("mcpAuthorization");
    await withOrg(c.env, c.var.org, (tx) =>
      tx.insert(mcpAuthorizations).values({
        id,
        organizationId: c.var.org,
        serverId: server.id,
        codeVerifier: verifier,
        redirectUri,
        createdBy: actor(c.var.caller).actorId,
        expiresAt: new Date(Date.now() + 600_000),
      }),
    );
    const url = new URL(client.authorizationEndpoint);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: client.clientId,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: `${c.var.org}.${id}`,
      resource: client.resource,
      ...(client.scope && { scope: client.scope }),
    }).toString();
    return c.json({ authorizationUrl: url.href }, 200);
  },
);

mcpRoutes.openapi(
  createRoute({
    method: "get",
    path: "/mcp-servers/{server}/tools",
    tags: ["MCP servers"],
    summary:
      "List the tools an MCP server offers, through the organization's connection",
    request: { params: ServerParams },
    responses: {
      200: {
        description: "Tools",
        content: {
          "application/json": {
            schema: z.array(
              z.object({
                name: z.string(),
                description: z.string().optional(),
                inputSchema: z.unknown(),
              }),
            ),
          },
        },
      },
    },
  }),
  async (c) => {
    const server = await findServer(
      c.env,
      c.var.org,
      c.req.valid("param").server,
    );
    return c.json(
      await listTools(c.env, c.var.org, server).catch(mcpFailure),
      200,
    );
  },
);

mcpRoutes.openapi(
  createRoute({
    method: "post",
    path: "/mcp-servers/{server}/connection/refresh",
    tags: ["MCP servers"],
    summary: "Refresh the organization's token for an MCP server now",
    request: { params: ServerParams },
    responses: { 204: { description: "Refreshed" } },
  }),
  async (c) => {
    requireAdmin(c.var.caller);
    const server = await findServer(
      c.env,
      c.var.org,
      c.req.valid("param").server,
    );
    await refreshConnection(c.env, c.var.org, server).catch(mcpFailure);
    return c.body(null, 204);
  },
);

mcpRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/mcp-servers/{server}/connection",
    tags: ["MCP servers"],
    summary: "Revoke the organization's connection to an MCP server",
    request: { params: ServerParams },
    responses: { 204: { description: "Revoked" } },
  }),
  async (c) => {
    requireAdmin(c.var.caller);
    const server = await findServer(
      c.env,
      c.var.org,
      c.req.valid("param").server,
    );
    await withOrg(c.env, c.var.org, async (tx) => {
      await tx
        .delete(mcpConnections)
        .where(eq(mcpConnections.serverId, server.id));
      await audit(tx, {
        ...eventBase(c.var),
        action: "mcp_connection.revoked",
        targetType: "mcp_server",
        targetId: server.id,
        data: { server: server.slug },
      });
    });
    return c.body(null, 204);
  },
);

// The OAuth redirect. It carries no session: the state names the
// organization and a sign-in that only the connect route created. It sends
// the browser back to the app's Integrations page with the outcome, as a
// fixed code rather than a message, so the link can't put words in the app.
export const mcpCallback = new OpenAPIHono<{ Bindings: Env }>();

class SignInFailed extends Error {
  constructor(readonly reason: "cancelled" | "expired" | "refused") {
    super(reason);
  }
}

mcpCallback.get("/mcp/oauth/callback", async (c) => {
  const back = new URL("/settings/organization/integrations", c.env.APP_URL);
  try {
    back.searchParams.set(
      "connected",
      await completeSignIn(c.env, (name) => c.req.query(name)),
    );
  } catch (error) {
    if (!(error instanceof SignInFailed)) throw error;
    back.searchParams.set("connect_error", error.reason);
  }
  return c.redirect(back.href, 303);
});

const completeSignIn = async (
  env: Env,
  query: (name: string) => string | undefined,
) => {
  const [org, id] = (query("state") ?? "").split(".");
  const code = query("code");
  if (!org || !id || !code) throw new SignInFailed("cancelled");
  const organization = orgId(org);
  return withOrg(env, organization, async (tx) => {
    const [pending] = await tx
      .delete(mcpAuthorizations)
      .where(eq(mcpAuthorizations.id, id))
      .returning();
    if (!pending || pending.expiresAt < new Date())
      throw new SignInFailed("expired");
    const [server] = await tx
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.id, pending.serverId));
    if (!server?.oauthClient) throw new SignInFailed("expired");
    const tokens = await tokenRequest(server.oauthClient, {
      grant_type: "authorization_code",
      code,
      redirect_uri: pending.redirectUri,
      code_verifier: pending.codeVerifier,
    }).catch(() => {
      throw new SignInFailed("refused");
    });
    await saveConnection(
      env,
      tx,
      organization,
      server.id,
      tokens,
      pending.createdBy,
    );
    await audit(tx, {
      organizationId: organization,
      actorType: pending.createdBy.startsWith("key_") ? "api_key" : "person",
      actorId: pending.createdBy,
      action: "mcp_connection.connected",
      targetType: "mcp_server",
      targetId: server.id,
      data: { server: server.slug },
    });
    return server.slug;
  });
};
