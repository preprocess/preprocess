// Metering (spec 16a): what our cloud bills each organization for, recorded
// where it happens and reported to the billing service later. A self-hosted
// install records nothing here.

import { sql } from "drizzle-orm";
import {
  bigint,
  date,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth.ts";

// cases: one per case created (a rerun is not a new case). model_usage,
// decide and ocr: micro-USD charged at our prices. log_bytes: run-log bytes
// stored, which storage counts.
export const meteredFeature = pgEnum("metered_feature", [
  "cases",
  "model_usage",
  "decide",
  "ocr",
  "log_bytes",
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
  },
  (t) => [
    index().on(t.organizationId, t.feature, t.at),
    index().on(t.organizationId, t.caseId),
    index("usage_records_unreported")
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
