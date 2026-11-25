// The case index (design doc 01): what the inbox and lists need. Per-case
// state lives in the case Durable Object. Written from step 3.

import { sql } from "drizzle-orm";
import {
  bigint,
  check,
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

import { agents, groups } from "./access.ts";
import { organization, user } from "./auth.ts";
import { bytea } from "./columns.ts";
import { deployments } from "./deployments.ts";

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
    deploymentId: text().notNull(),
    status: caseStatus().notNull(),
    waitingOnGroupId: text(),
    // When the case started waiting on that group: the inbox item's key.
    waitingSince: timestamp({ withTimezone: true }),
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
    // A deployment that served cases cannot be deleted on its own; deleting
    // the organization removes both in one statement.
    foreignKey({
      columns: [t.organizationId, t.deploymentId],
      foreignColumns: [deployments.organizationId, deployments.id],
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

// Idempotency-Key on POST /v1/orgs/{org}/cases (design doc 04), kept 24 hours.
// The fingerprint is SHA-256 of the canonical body and the credential id.
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    operation: text().notNull(),
    key: text().notNull(),
    fingerprint: bytea().notNull(),
    caseId: text(),
    responseBody: jsonb(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.operation, t.key] }),
    index().on(t.expiresAt),
    check(
      "idempotency_keys_key_length",
      sql`char_length(${t.key}) between 1 and 255`,
    ),
  ],
);

// Files uploaded through POST /v1/orgs/{org}/files; the bytes are in R2 under
// the organization. A file joins a case when the case is created with it.
export const files = pgTable(
  "files",
  {
    id: text().primaryKey(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    caseId: text(),
    name: text().notNull(),
    contentType: text().notNull(),
    size: bigint({ mode: "number" }).notNull(),
    sha256: bytea().notNull(),
    r2Key: text().notNull(),
    createdBy: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("files_org_id_unique").on(t.organizationId, t.id),
    index().on(t.organizationId, t.caseId),
    foreignKey({
      columns: [t.organizationId, t.caseId],
      foreignColumns: [cases.organizationId, cases.id],
    }).onDelete("cascade"),
  ],
);

// Every change a person makes to a case's answers or flow (design doc 05).
// Agent writes are in run capture instead.
export const reviewEvents = pgTable(
  "review_events",
  {
    id: text().primaryKey(),
    organizationId: text().notNull(),
    caseId: text().notNull(),
    userId: text().notNull(),
    kind: text().notNull(),
    path: text(),
    before: jsonb(),
    after: jsonb(),
    checks: jsonb(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.organizationId, t.caseId, t.at),
    foreignKey({
      columns: [t.organizationId, t.caseId],
      foreignColumns: [cases.organizationId, cases.id],
    }).onDelete("cascade"),
  ],
);

// A group named in a case's thread, by the agent or by a person (doc 06).
export const caseMentions = pgTable(
  "case_mentions",
  {
    id: text().primaryKey(),
    organizationId: text().notNull(),
    caseId: text().notNull(),
    groupId: text().notNull(),
    messageId: text().notNull(),
    by: text().notNull(),
    message: text().notNull(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.organizationId, t.groupId, t.at),
    foreignKey({
      columns: [t.organizationId, t.caseId],
      foreignColumns: [cases.organizationId, cases.id],
    }).onDelete("cascade"),
    // A mentioned group cannot be deleted while its organization exists
    // (trigger in migrations/0003_step3_security.sql); the cascade only runs
    // when the organization goes.
    foreignKey({
      columns: [t.organizationId, t.groupId],
      foreignColumns: [groups.organizationId, groups.id],
    }).onDelete("cascade"),
  ],
);

// What a person has read in the inbox, by item key:
// "mention:<id>", "waiting:<caseId>:<since>" or "assigned:<caseId>:<at>".
export const inboxReads = pgTable(
  "inbox_reads",
  {
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    itemKey: text().notNull(),
    readAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.userId, t.itemKey] })],
);

// Work to hand to a Queue once the transaction that decided it commits: a
// case start, a webhook delivery or a notification email. A row is drained
// when it was sent; a cron re-sends rows left undrained (design doc 04).
export const outboxKind = pgEnum("outbox_kind", [
  "case.start",
  "webhook",
  "email",
  "eval.start",
]);

export const outbox = pgTable(
  "outbox",
  {
    id: text().primaryKey(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: outboxKind().notNull(),
    payload: jsonb().notNull(),
    attempts: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    drainedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index("outbox_undrained")
      .on(t.createdAt)
      .where(sql`drained_at is null`),
  ],
);
