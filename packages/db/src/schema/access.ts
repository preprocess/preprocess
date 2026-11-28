// Groups, agents and per-agent grants (design doc 01). A person gets agent
// access only through a group; the Developers group manages every agent.

import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth.ts";

export const groups = pgTable(
  "groups",
  {
    id: text().primaryKey(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    slug: text().notNull(),
    name: text().notNull(),
    description: text(),
    isDevelopers: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // Set on a group synced from the organization's identity provider (the
    // SCIM Group's id): its name and members follow the directory and are
    // read-only here. syncedRemovedAt is set when the directory deletes it;
    // the group and its grants stay until an Owner or Admin acts.
    scimGroupId: text(),
    syncedRemovedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    unique().on(t.organizationId, t.slug),
    uniqueIndex("groups_scim_group_id_unique").on(t.scimGroupId),
    unique("groups_org_id_unique").on(t.organizationId, t.id),
    uniqueIndex("one_developers_group")
      .on(t.organizationId)
      .where(sql`is_developers`),
  ],
);

export const groupMembers = pgTable(
  "group_members",
  {
    organizationId: text().notNull(),
    groupId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    addedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.userId] }),
    index().on(t.organizationId, t.userId),
    foreignKey({
      columns: [t.organizationId, t.groupId],
      foreignColumns: [groups.organizationId, groups.id],
    }).onDelete("cascade"),
  ],
);

// Rows are created by an agent's first deploy (step 2).
export const agents = pgTable(
  "agents",
  {
    id: text().primaryKey(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    slug: text().notNull(),
    archivedAt: timestamp({ withTimezone: true }),
    // Deploys from this branch serve production; others are previews (spec 4).
    productionBranch: text().notNull().default("main"),
  },
  (t) => [
    unique().on(t.organizationId, t.slug),
    unique("agents_org_id_unique").on(t.organizationId, t.id),
  ],
);

export const agentAccess = pgEnum("agent_access", ["operator", "viewer"]);

// A group with a grant cannot be deleted. The foreign key is NO ACTION rather
// than RESTRICT so deleting an organization, which cascades to agents and
// groups in one statement, is checked only once both are gone.
export const agentGrants = pgTable(
  "agent_grants",
  {
    organizationId: text().notNull(),
    agentId: text().notNull(),
    groupId: text().notNull(),
    access: agentAccess().notNull(),
    grantedBy: text().notNull(),
    grantedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.groupId] }),
    index().on(t.organizationId, t.groupId),
    foreignKey({
      columns: [t.organizationId, t.agentId],
      foreignColumns: [agents.organizationId, agents.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.groupId],
      foreignColumns: [groups.organizationId, groups.id],
    }),
  ],
);
