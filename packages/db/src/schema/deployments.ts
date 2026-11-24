// Deployments and the secrets each one receives (build step 2, design doc 03).
// A deployment pins one upload of an agent's code: its bundle, SDK version,
// model and reasoning level, and what it declared in its manifest. It is
// created by `preprocess deploy` or the GitHub App; agents never edit it.

import { sql } from "drizzle-orm";
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
import { secrets } from "./secrets.ts";

// waiting: built, but it asks for more than a guardrail allows (spec 5), so
// it cannot be promoted until an Admin approves.
export const deploymentStatus = pgEnum("deployment_status", [
  "ready",
  "waiting",
  "failed",
]);

export const deploymentSource = pgEnum("deployment_source", ["cli", "github"]);

export type WaitingFor = { secrets?: string[] };

export const deployments = pgTable(
  "deployments",
  {
    id: text().primaryKey(),
    organizationId: text().notNull(),
    agentId: text().notNull(),
    status: deploymentStatus().notNull(),
    // The Workers for Platforms script in the stage's dispatch namespace.
    scriptName: text().notNull(),
    bundleSha256: text().notNull(),
    sdkVersion: text().notNull(),
    model: text().notNull(),
    reasoning: text().notNull(),
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

// What each script actually holds, for the "delivered to n of m" status and
// for audit (spec 12: which deployment received a secret).
export const secretDeliveries = pgTable(
  "secret_deliveries",
  {
    organizationId: text().notNull(),
    deploymentId: text().notNull(),
    secretId: text().notNull(),
    secretVersion: integer().notNull(),
    deliveredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.deploymentId, t.secretId] }),
    index().on(t.organizationId, t.secretId),
    foreignKey({
      columns: [t.organizationId, t.deploymentId],
      foreignColumns: [deployments.organizationId, deployments.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.secretId],
      foreignColumns: [secrets.organizationId, secrets.id],
    }).onDelete("cascade"),
  ],
);
