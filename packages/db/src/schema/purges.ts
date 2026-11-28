// Deleting an organization (apps/api/src/purge.ts). Its rows go with it by
// cascade in the same transaction; what it owns outside Postgres (R2 objects
// and Durable Object state) is deleted afterwards from the JOBS queue, so
// these rows outlive the organization and have no foreign key to it. The
// Durable Objects are named from rows the cascade removes, so their names
// are copied here first; each is deleted from the list once wiped.

import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// One per deleted organization; completed once nothing it owned is left.
export const organizationPurges = pgTable(
  "organization_purges",
  {
    organizationId: text().primaryKey(),
    requestedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    attemptedAt: timestamp({ withTimezone: true }),
    completedAt: timestamp({ withTimezone: true }),
    counts: jsonb().$type<Record<string, number>>().notNull().default({}),
  },
  (t) => [
    index("organization_purges_open")
      .on(t.requestedAt)
      .where(sql`completed_at is null`),
  ],
);

// case: a case's object (and its sandbox), agent id and case id.
// scheduler: an agent's scheduler, agent id and "" or a preview's id.
// builds: a build queue, agent slug and branch.
export const PURGE_OBJECT_KINDS = ["case", "scheduler", "builds"] as const;
export type PurgeObjectKind = (typeof PURGE_OBJECT_KINDS)[number];

export const organizationPurgeObjects = pgTable(
  "organization_purge_objects",
  {
    organizationId: text().notNull(),
    kind: text().$type<PurgeObjectKind>().notNull(),
    agent: text().notNull(),
    name: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.kind, t.agent, t.name] })],
);
