// Deployments (design doc 01, build step 2). A deployment pins one upload of
// an agent's code: its bundle in R2 (loaded as a Dynamic Worker, doc 03), SDK
// version, network rules and manifest. `preprocess deploy` or the GitHub App
// creates it; agents never edit it.

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { agents, groups } from "./access.ts";
import { secrets } from "./secrets.ts";

// Deploys from the agent's production branch are production; any other
// branch is a preview (spec 4).
export const deploymentEnvironment = pgEnum("deployment_environment", [
  "production",
  "preview",
]);

// waiting: built, but it asks for more than a guardrail allows (spec 5), so
// it cannot serve until an Admin approves.
export const deploymentStatus = pgEnum("deployment_status", [
  "ready",
  "waiting",
  "failed",
]);

export const deploymentSource = pgEnum("deployment_source", ["cli", "github"]);

// The same shape the outbound Worker enforces (apps/outbound).
export type NetworkRules = { allow: string[]; block: string[] };
export type WaitingFor = {
  secrets?: string[];
  mcp?: string[];
  network?: string[];
  groups?: string[];
  // A sandbox larger than the organization's largest allowed size.
  sandboxSize?: "small" | "medium" | "large";
};

export const deployments = pgTable(
  "deployments",
  {
    id: text().primaryKey(),
    organizationId: text().notNull(),
    agentId: text().notNull(),
    environment: deploymentEnvironment().notNull(),
    status: deploymentStatus().notNull(),
    // The SHA-256 of the bundle object in R2: the runtime checks every load
    // against it (doc 03).
    bundleSha256: text().notNull(),
    sdkVersion: text().notNull(),
    network: jsonb()
      .$type<NetworkRules>()
      .notNull()
      .default({ allow: [], block: [] }),
    manifest: jsonb().notNull(),
    waitingFor: jsonb().$type<WaitingFor>().notNull().default({}),
    gitBranch: text(),
    gitCommit: text(),
    source: deploymentSource().notNull(),
    createdBy: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // The agent's production deployment is the one promoted most recently;
    // rolling back promotes an earlier one again.
    promotedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    unique("deployments_org_id_unique").on(t.organizationId, t.id),
    index().on(t.organizationId, t.agentId, t.createdAt),
    index()
      .on(t.organizationId, t.agentId, t.promotedAt)
      .where(sql`promoted_at is not null`),
    foreignKey({
      columns: [t.organizationId, t.agentId],
      foreignColumns: [agents.organizationId, agents.id],
    }).onDelete("cascade"),
    check(
      "deployments_only_production_is_promoted",
      sql`${t.promotedAt} IS NULL OR ${t.environment} = 'production'`,
    ),
  ],
);

// Groups named in a deployment's code, to wait on, tag or approve. The deploy
// fails if one has no access to the agent, and the API refuses deleting a
// group, or its grant, that a live deployment names (doc 01).
export const deploymentGroups = pgTable(
  "deployment_groups",
  {
    organizationId: text().notNull(),
    deploymentId: text().notNull(),
    groupId: text().notNull(),
    // Approvers must stay operators on the agent.
    approves: boolean().notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.deploymentId, t.groupId] }),
    index().on(t.organizationId, t.groupId),
    foreignKey({
      columns: [t.organizationId, t.deploymentId],
      foreignColumns: [deployments.organizationId, deployments.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.groupId],
      foreignColumns: [groups.organizationId, groups.id],
    }).onDelete("cascade"),
  ],
);

// The guardrail "which organization secrets an agent's code receives"
// (spec 5): a deployment is bound the secrets it declares and the agent is
// granted. Granting is loosening, so only an Admin or Owner writes it.
export const secretGrants = pgTable(
  "secret_grants",
  {
    organizationId: text().notNull(),
    secretId: text().notNull(),
    agentId: text().notNull(),
    grantedBy: text().notNull(),
    grantedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.secretId, t.agentId] }),
    index().on(t.organizationId, t.agentId),
    foreignKey({
      columns: [t.organizationId, t.secretId],
      foreignColumns: [secrets.organizationId, secrets.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.agentId],
      foreignColumns: [agents.organizationId, agents.id],
    }).onDelete("cascade"),
  ],
);
