// Organization guardrails stored outside the grant tables (spec 5). Only an
// Owner or Admin loosens one; their direct change is the approval.

import { bigint, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { organization } from "./auth.ts";

export const organizationGuardrails = pgTable("organization_guardrails", {
  organizationId: text()
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  // Per calendar month in UTC; null is no limit, the default (doc 04).
  spendingLimitMicroUsd: bigint({ mode: "number" }),
  updatedBy: text().notNull(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
