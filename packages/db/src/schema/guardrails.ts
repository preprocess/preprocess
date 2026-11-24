// Organization guardrails stored outside the grant tables (spec 5). Only an
// Owner or Admin loosens one; their direct change is the approval. Anyone else,
// and a deployment that asks for more than a guardrail allows, files a
// guardrail request for an Owner or Admin to approve.

import {
  bigint,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { agents } from "./access.ts";
import { organization } from "./auth.ts";
import { deployments } from "./deployments.ts";

// The outbound Worker's rules: a host passes when no block pattern matches it
// and the allow list is empty or one of its patterns matches.
export type NetworkRules = { allow: string[]; block: string[] };

export const organizationGuardrails = pgTable("organization_guardrails", {
  organizationId: text()
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  // Per calendar month in UTC; null is no limit, the default (doc 04).
  spendingLimitMicroUsd: bigint({ mode: "number" }),
  // New organizations allow every host and block none.
  network: jsonb()
    .$type<NetworkRules>()
    .notNull()
    .default({ allow: [], block: [] }),
  updatedBy: text().notNull(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Per-agent rules, which only narrow the organization's.
export const agentNetworkRules = pgTable(
  "agent_network_rules",
  {
    organizationId: text().notNull(),
    agentId: text().notNull(),
    rules: jsonb().$type<NetworkRules>().notNull(),
    updatedBy: text().notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.agentId] }),
    foreignKey({
      columns: [t.organizationId, t.agentId],
      foreignColumns: [agents.organizationId, agents.id],
    }).onDelete("cascade"),
  ],
);

export const guardrailKind = pgEnum("guardrail_kind", [
  "network",
  "secret",
  "mcp",
  "spending_limit",
]);

export const guardrailRequestStatus = pgEnum("guardrail_request_status", [
  "pending",
  "approved",
  "rejected",
]);

// What a request asks for, by kind. A network request asks to reach hosts:
// for one agent when it names an agent, else for every agent.
export type GuardrailChange =
  | { kind: "network"; hosts: string[] }
  | { kind: "secret"; secret: string }
  | { kind: "mcp"; server: string }
  | { kind: "spending_limit"; limitUsd: number | null };

export const guardrailRequests = pgTable(
  "guardrail_requests",
  {
    id: text().primaryKey(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: guardrailKind().notNull(),
    agentId: text(),
    // Set when a deployment asked for more than the guardrail allows.
    deploymentId: text(),
    change: jsonb().$type<GuardrailChange>().notNull(),
    reason: text(),
    status: guardrailRequestStatus().notNull().default("pending"),
    requestedByType: text().notNull(),
    requestedBy: text().notNull(),
    decidedBy: text(),
    decidedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.organizationId, t.status),
    foreignKey({
      columns: [t.organizationId, t.agentId],
      foreignColumns: [agents.organizationId, agents.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.deploymentId],
      foreignColumns: [deployments.organizationId, deployments.id],
    }).onDelete("cascade"),
  ],
);
