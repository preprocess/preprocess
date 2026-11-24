// Settings that are defaults, not guardrails (spec 5): organization defaults
// and an agent's dashboard overrides. Values are keyed by setting ("model",
// "evals.onPush", "schedules.<name>.previews"). Code wins at deploy: promoting
// a deployment clears the agent's overrides.

import {
  foreignKey,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { agents } from "./access.ts";
import { organization } from "./auth.ts";

export type SettingValues = Record<string, string | number | boolean>;

export const organizationDefaults = pgTable("organization_defaults", {
  organizationId: text()
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  values: jsonb().$type<SettingValues>().notNull().default({}),
  updatedBy: text().notNull(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const agentOverrides = pgTable(
  "agent_overrides",
  {
    organizationId: text().notNull(),
    agentId: text().notNull(),
    values: jsonb().$type<SettingValues>().notNull().default({}),
    updatedBy: text().notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.agentId] }),
    foreignKey({
      columns: [t.organizationId, t.agentId],
      foreignColumns: [agents.organizationId, agents.id],
    }).onDelete("cascade"),
  ],
);
