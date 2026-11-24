// Run logs live in R2 (design doc 09). Postgres keeps only these summaries,
// one row per case and one per deployment, updated by the LOGS queue's
// consumer as records arrive.

import {
  bigint,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { organization } from "./auth.ts";

export const logSubject = pgEnum("log_subject", ["case", "deployment"]);

export type LastError = { at: string; kind: string; message: string };

export const logSummaries = pgTable(
  "log_summaries",
  {
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    subjectKind: logSubject().notNull(),
    subjectId: text().notNull(),
    events: bigint({ mode: "number" }).notNull().default(0),
    errors: bigint({ mode: "number" }).notNull().default(0),
    warnings: bigint({ mode: "number" }).notNull().default(0),
    lastError: jsonb().$type<LastError>(),
    firstAt: timestamp({ withTimezone: true }).notNull(),
    lastAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.subjectKind, t.subjectId] }),
  ],
);
