// Outbound webhooks (design doc 06): Standard Webhooks signatures, delivered
// at least once through a Queue, with a delivery log.

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { organization } from "./auth.ts";
import { cases } from "./cases.ts";
import { bytea } from "./columns.ts";

export const webhookEvents = [
  "case.completed",
  "case.failed",
  "case.needs_group",
] as const;

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: text().primaryKey(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    url: text().notNull(),
    events: text().array().notNull(),
    // null: every agent.
    agentIds: text().array(),
    // The whsec_ secret, encrypted with the organization's key like secrets
    // (design doc 01), with additional data organization|endpoint|keyVersion.
    keyVersion: integer().notNull(),
    signingSecret: bytea().notNull(),
    // After a rotation the old secret signs too, for 24 hours.
    previousSigningSecret: bytea(),
    previousKeyVersion: integer(),
    previousExpiresAt: timestamp({ withTimezone: true }),
    enabled: boolean().notNull().default(true),
    disabledReason: text(),
    createdBy: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("webhook_endpoints_org_id_unique").on(t.organizationId, t.id),
    check("webhook_endpoints_https", sql`${t.url} like 'https://%'`),
  ],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    // msg_…, also the webhook-id header.
    id: text().primaryKey(),
    organizationId: text().notNull(),
    endpointId: text().notNull(),
    eventType: text().notNull(),
    caseId: text().notNull(),
    payload: jsonb().notNull(),
    status: text({ enum: ["pending", "delivered", "failed"] }).notNull(),
    attempts: integer().notNull().default(0),
    lastStatusCode: integer(),
    lastError: text(),
    nextAttemptAt: timestamp({ withTimezone: true }),
    deliveredAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.organizationId, t.endpointId, t.createdAt),
    index("webhook_deliveries_due")
      .on(t.nextAttemptAt)
      .where(sql`status = 'pending'`),
    foreignKey({
      columns: [t.organizationId, t.endpointId],
      foreignColumns: [webhookEndpoints.organizationId, webhookEndpoints.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.caseId],
      foreignColumns: [cases.organizationId, cases.id],
    }).onDelete("cascade"),
  ],
);
