// The case index (design doc 01): what the inbox and lists need. Per-case
// state lives in the case Durable Object. Written from step 3.

import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { agents, groups } from "./access.ts";
import { organization } from "./auth.ts";

export const caseStatus = pgEnum("case_status", [
  "queued",
  "running",
  "waiting",
  "halted",
  "completed",
  "failed",
  "cancelled",
]);
export const haltReason = pgEnum("halt_reason", [
  "credit_exhausted",
  "spending_limit_reached",
]);
export const caseSource = pgEnum("case_source", [
  "api",
  "app",
  "mcp",
  "schedule",
]);

export const cases = pgTable(
  "cases",
  {
    id: text().primaryKey(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    agentId: text().notNull(),
    // Foreign key to deployments is added in step 2.
    deploymentId: text().notNull(),
    status: caseStatus().notNull(),
    waitingOnGroupId: text(),
    haltReason: haltReason(),
    source: caseSource().notNull(),
    title: text(),
    costMicroUsd: bigint({ mode: "number" }).notNull().default(0),
    createdBy: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    unique("cases_org_id_unique").on(t.organizationId, t.id),
    index().on(t.organizationId, t.waitingOnGroupId, t.status),
    index().on(t.organizationId, t.agentId, t.createdAt),
    foreignKey({
      columns: [t.organizationId, t.agentId],
      foreignColumns: [agents.organizationId, agents.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.waitingOnGroupId],
      foreignColumns: [groups.organizationId, groups.id],
    }),
    check(
      "cases_halt_reason_only_when_halted",
      sql`(${t.status} = 'halted') = (${t.haltReason} IS NOT NULL)`,
    ),
  ],
);

// Assigned through the API or by an Admin in the app; never by agent code.
export const caseAssignees = pgTable(
  "case_assignees",
  {
    organizationId: text().notNull(),
    caseId: text().notNull(),
    userId: text().notNull(),
    assignedBy: text().notNull(),
    assignedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.caseId, t.userId] }),
    index().on(t.organizationId, t.userId),
    foreignKey({
      columns: [t.organizationId, t.caseId],
      foreignColumns: [cases.organizationId, cases.id],
    }).onDelete("cascade"),
  ],
);
