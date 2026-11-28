// Datasets (design doc 10): a saved query over one agent's closed cases, not
// a copy of their data. Exports read the cases, their run capture and review
// events at the time of the export.

import {
  foreignKey,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { agents } from "./access.ts";
import { organization } from "./auth.ts";

export type DatasetStatus = "completed" | "failed" | "halted" | "cancelled";

// Version 1, told apart by its shape. A period is a rolling window ending
// now, in place of from and to.
export type DatasetPeriod = "7d" | "30d" | "90d" | "all";
export type DatasetQuery = {
  period?: DatasetPeriod | undefined;
  from?: string | undefined;
  to?: string | undefined;
  status?: DatasetStatus[] | undefined;
  deployments?: string[] | undefined;
  edited?: { any: true } | { fields: string[] } | { none: true } | undefined;
  outcome?: "corrected" | "accepted" | undefined;
};

export const datasets = pgTable(
  "datasets",
  {
    id: text().primaryKey(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    agentId: text().notNull(),
    name: text().notNull(),
    query: jsonb().$type<DatasetQuery>().notNull(),
    createdBy: text().notNull(),
    updatedBy: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("datasets_org_id_unique").on(t.organizationId, t.id),
    unique().on(t.organizationId, t.agentId, t.name),
    foreignKey({
      columns: [t.organizationId, t.agentId],
      foreignColumns: [agents.organizationId, agents.id],
    }).onDelete("cascade"),
  ],
);
