// Retention controls (spec 16a): how long an organization keeps documents,
// run capture, run logs and whole cases after a case closes. A null period
// keeps forever, the default. The daily sweep (apps/api/src/retention.ts)
// deletes what is past its period and records each organization's purge per
// kind in retention_sweeps until its one audit event is written.

import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { organization } from "./auth.ts";

export const RETENTION_KINDS = [
  "cases",
  "documents",
  "runCapture",
  "runLogs",
] as const;
export type RetentionKind = (typeof RETENTION_KINDS)[number];

export const MIN_RETENTION_DAYS = 7;

const period = (name: string) =>
  sql.raw(`(${name} IS NULL OR ${name} >= ${MIN_RETENTION_DAYS})`);

export const organizationRetention = pgTable(
  "organization_retention",
  {
    organizationId: text()
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    documentsDays: integer(),
    runCaptureDays: integer(),
    runLogsDays: integer(),
    casesDays: integer(),
    updatedBy: text().notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    check("organization_retention_documents_days", period("documents_days")),
    check(
      "organization_retention_run_capture_days",
      period("run_capture_days"),
    ),
    check("organization_retention_run_logs_days", period("run_logs_days")),
    check("organization_retention_cases_days", period("cases_days")),
  ],
);

// One open row per organization and kind while a sweep deletes in batches;
// the row is closed (audited_at) when its retention.purged event is written,
// so a sweep that stops partway is audited by the next one.
export const retentionSweeps = pgTable(
  "retention_sweeps",
  {
    id: text().primaryKey(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text().$type<RetentionKind>().notNull(),
    days: integer().notNull(),
    cutoff: timestamp({ withTimezone: true }).notNull(),
    counts: jsonb().$type<Record<string, number>>().notNull().default({}),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    auditedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index("retention_sweeps_open")
      .on(t.organizationId, t.kind)
      .where(sql`audited_at is null`),
  ],
);
