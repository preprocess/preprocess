// The audit chain (design doc 02): append-only, hash-chained per organization,
// written in the same transaction as the action. No foreign keys, so audit rows
// outlive cases and organizations.

import {
  bigint,
  index,
  inet,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { bytea } from "./columns.ts";

export const auditActor = pgEnum("audit_actor", [
  "person",
  "agent",
  "api_key",
  "platform",
]);

export const auditEvents = pgTable(
  "audit_events",
  {
    organizationId: text().notNull(),
    seq: bigint({ mode: "number" }).notNull(),
    id: text().notNull().unique(),
    occurredAt: timestamp({ withTimezone: true, precision: 6 }).notNull(),
    actorType: auditActor().notNull(),
    actorId: text().notNull(),
    onBehalfOf: text(),
    action: text().notNull(),
    targetType: text(),
    targetId: text(),
    caseId: text(),
    requestId: text(),
    ip: inet(),
    data: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    prevHash: bytea().notNull(),
    hash: bytea().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.seq] }),
    index().on(t.organizationId, t.occurredAt),
    index().on(t.organizationId, t.caseId),
  ],
);

export const auditHeads = pgTable("audit_heads", {
  organizationId: text().primaryKey(),
  seq: bigint({ mode: "number" }).notNull(),
  hash: bytea().notNull(),
  // The day of the last signed manifest, so the daily job finds empty days.
  anchoredThrough: text(),
});

// Not tenant-scoped; written by the organization delete flow.
export const deletedOrganizations = pgTable("deleted_organizations", {
  organizationId: text().primaryKey(),
  deletedAt: timestamp({ withTimezone: true }).notNull(),
  finalSeq: bigint({ mode: "number" }).notNull(),
  finalHash: bytea().notNull(),
});
