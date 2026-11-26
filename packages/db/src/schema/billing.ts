// Metering (spec 16a): what our cloud bills each organization for, recorded
// where it happens and reported to the billing service later. A self-hosted
// install records nothing here.

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
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

import { organization, user } from "./auth.ts";

// cases: one per case created (a rerun is not a new case). model_usage,
// decide and ocr: micro-USD charged at our prices. log_bytes: run-log bytes
// stored, which storage counts. sandbox: micro-USD for case sandbox time.
// case_fees: micro-USD for a case past the month's free ones.
export const meteredFeature = pgEnum("metered_feature", [
  "cases",
  "model_usage",
  "decide",
  "ocr",
  "log_bytes",
  "sandbox",
  "case_fees",
]);

export const usageRecords = pgTable(
  "usage_records",
  {
    id: text().primaryKey(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    feature: meteredFeature().notNull(),
    quantity: bigint({ mode: "number" }).notNull(),
    // The case or eval case it was charged to; none for the OCR API.
    caseId: text(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // When the billing service accepted it.
    reportedAt: timestamp({ withTimezone: true }),
    // The usage report that carried it to the billing service.
    reportId: text(),
  },
  (t) => [
    index().on(t.organizationId, t.feature, t.at),
    index().on(t.organizationId, t.caseId),
    index("usage_records_unreported")
      .on(t.at)
      .where(sql`reported_at is null`),
  ],
);

// What reached the billing service: whole billed units (cases, credits of
// $0.01, GB-months), with what was left under one unit carried into the next
// report of the same feature, so nothing is ever rounded up.
export const usageReports = pgTable(
  "usage_reports",
  {
    id: text().primaryKey(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // The billing service's feature id.
    feature: text().notNull(),
    // Reports of a feature in order; each carries on from the one before.
    seq: integer().notNull(),
    // Whole billed units sent.
    quantity: bigint({ mode: "number" }).notNull(),
    // Ledger units under one billed unit, carried into the next report.
    remainder: bigint({ mode: "number" }).notNull(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // When the billing service accepted it.
    reportedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    unique().on(t.organizationId, t.feature, t.seq),
    index("usage_reports_unreported")
      .on(t.at)
      .where(sql`reported_at is null`),
  ],
);

export const seatRole = pgEnum("seat_role", ["operator", "developer"]);

// A person who did paid-seat work in a month (spec 16a): an operator who
// worked, approved or commented on a case, or a developer who deployed or
// ran an eval. Signing in alone never counts.
export const seatActivity = pgTable(
  "seat_activity",
  {
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // The first day of the UTC month.
    month: date({ mode: "string" }).notNull(),
    role: seatRole().notNull(),
    firstAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.month, t.userId, t.role] }),
  ],
);

// What a sandbox is for: a GitHub build or a PDF render, which are ours and
// never billed, or a case, which bills by size and seconds awake.
export const sandboxKind = pgEnum("sandbox_kind", ["build", "render", "case"]);
// How an awake interval ended: the sandbox slept or was destroyed, or it
// crashed or went silent, in which case it ends at its last heartbeat.
export const sandboxEnd = pgEnum("sandbox_end", [
  "sleep",
  "destroy",
  "crash",
  "lost",
]);

// One awake interval of one sandbox (apps/api/src/sandbox.ts), timed by the
// platform: from start or wake to sleep or destroy, or to the last heartbeat
// when no such event came. A sandbox numbers its intervals, so each is written
// and closed once. Closing a case sandbox's interval bills it.
export const sandboxIntervals = pgTable(
  "sandbox_intervals",
  {
    id: text().primaryKey(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    sandboxId: text().notNull(),
    seq: integer().notNull(),
    // The agent's id, or for a build its slug: a first build can come before
    // the agent exists.
    agent: text(),
    caseId: text(),
    kind: sandboxKind().notNull(),
    // A case sandbox's size id (small, medium, large); for a build or render,
    // the Cloudflare instance type.
    size: text().notNull(),
    startedAt: timestamp({ withTimezone: true }).notNull(),
    lastSeenAt: timestamp({ withTimezone: true }).notNull(),
    endedAt: timestamp({ withTimezone: true }),
    endReason: sandboxEnd(),
  },
  (t) => [
    unique().on(t.sandboxId, t.seq),
    index().on(t.organizationId, t.startedAt),
    index("sandbox_intervals_open")
      .on(t.lastSeenAt)
      .where(sql`ended_at is null`),
  ],
);

// Free's one-time $5 of credits (PRE-96): at most once per organization and
// once per card. Not tenant-scoped, and kept when an organization is deleted,
// so a new organization on the same card gets none. granted is false when the
// card had already had it elsewhere.
export const freeCreditGrants = pgTable("free_credit_grants", {
  organizationId: text().primaryKey(),
  cardFingerprint: text().unique(),
  granted: boolean().notNull(),
  at: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// A move down to Free waiting for the end of Team's billing period (PRE-96):
// who the Owner picked to keep a seat, why they left, and whether the people
// losing a seat were warned. The switch at the period's end deletes the row;
// so does keeping Team.
export const planChanges = pgTable("plan_changes", {
  organizationId: text()
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  plan: text().notNull(),
  at: timestamp({ withTimezone: true }),
  keep: jsonb().$type<string[]>(),
  reason: text(),
  requestedBy: text().notNull(),
  requestedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  warnedAt: timestamp({ withTimezone: true }),
});

// The seat groups people left when Team ended (PRE-96), so an Owner back on
// Team can restore their previous roles in one step.
export const demotedSeats = pgTable(
  "demoted_seats",
  {
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    groupId: text().notNull(),
    demotedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.userId, t.groupId] })],
);
