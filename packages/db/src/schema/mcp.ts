// MCP servers and the organization's connections to them (spec: full MCP
// support; design doc 03). Every connection belongs to the organization;
// there are no personal connections. Tokens are encrypted like secrets and
// never leave the API Worker: agent code reaches a server through the MCP
// token service, which adds the token.

import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { agents } from "./access.ts";
import { organization } from "./auth.ts";
import { bytea } from "./columns.ts";

export const mcpAuth = pgEnum("mcp_auth", ["none", "oauth"]);

// The OAuth client the platform registered with the server's authorization
// server (dynamic client registration), and where to send people.
export type McpOAuthClient = {
  clientId: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  resource: string;
  scope?: string;
};

// A remote server agent code names in its `mcp` list, by slug.
export const mcpServers = pgTable(
  "mcp_servers",
  {
    id: text().primaryKey(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    slug: text().notNull(),
    url: text().notNull(),
    auth: mcpAuth().notNull(),
    oauthClient: jsonb().$type<McpOAuthClient>(),
    createdBy: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.organizationId, t.slug),
    unique("mcp_servers_org_id_unique").on(t.organizationId, t.id),
  ],
);

// The guardrail "which MCP servers an agent can use" (spec 5). Granting is
// loosening, so only an Admin or Owner writes it.
export const mcpGrants = pgTable(
  "mcp_grants",
  {
    organizationId: text().notNull(),
    serverId: text().notNull(),
    agentId: text().notNull(),
    grantedBy: text().notNull(),
    grantedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.serverId, t.agentId] }),
    index().on(t.organizationId, t.agentId),
    foreignKey({
      columns: [t.organizationId, t.serverId],
      foreignColumns: [mcpServers.organizationId, mcpServers.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.agentId],
      foreignColumns: [agents.organizationId, agents.id],
    }).onDelete("cascade"),
  ],
);

export const mcpConnectionStatus = pgEnum("mcp_connection_status", [
  "active",
  "needs_reauth",
  "revoked",
]);

// One per server: { accessToken, refreshToken, expiresAt } encrypted with
// the organization's key, additional data `organization|connection|version`.
export const mcpConnections = pgTable(
  "mcp_connections",
  {
    id: text().primaryKey(),
    organizationId: text().notNull(),
    serverId: text().notNull(),
    version: integer().notNull(),
    keyVersion: integer().notNull(),
    ciphertext: bytea().notNull(),
    status: mcpConnectionStatus().notNull(),
    connectedBy: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.serverId),
    foreignKey({
      columns: [t.organizationId, t.serverId],
      foreignColumns: [mcpServers.organizationId, mcpServers.id],
    }).onDelete("cascade"),
  ],
);

// An OAuth sign-in in progress: its state (the row id) and PKCE verifier,
// for ten minutes.
export const mcpAuthorizations = pgTable(
  "mcp_authorizations",
  {
    id: text().primaryKey(),
    organizationId: text().notNull(),
    serverId: text().notNull(),
    codeVerifier: text().notNull(),
    redirectUri: text().notNull(),
    createdBy: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.serverId],
      foreignColumns: [mcpServers.organizationId, mcpServers.id],
    }).onDelete("cascade"),
  ],
);
