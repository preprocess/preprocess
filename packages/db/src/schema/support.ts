// Support requests (support center spec, PRE-155). A customer's request lives
// in their own organization, beside every other tenant row; a request from a
// signed-out visitor, or an email from an address that is no single member's,
// has no organization and carries only the requester's email. Each request is
// also a case in our own Preprocess Support organization (SUPPORT_ORG_ID),
// whose id is kept here; nothing of the customer's beyond the request itself
// goes there. Hosted only: a self-hosted install never writes these tables.

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth.ts";

export const SUPPORT_CATEGORIES = [
  "getting-started",
  "agents",
  "billing-and-credits",
  "integrations",
  "security-and-sso",
  "self-hosting",
  "other",
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const SUPPORT_STATUSES = [
  "open",
  "waiting_on_customer",
  "waiting_on_us",
  "solved",
] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export const SUPPORT_CHANNELS = [
  "form",
  "email",
  "api",
  "mcp",
  "slack",
] as const;
export type SupportChannel = (typeof SUPPORT_CHANNELS)[number];

export type SupportAuthorKind = "customer" | "agent" | "operator";

// Attachments are at most 25 MB each.
export const SUPPORT_ATTACHMENT_MAX_BYTES = 26_214_400;

export const supportRequests = pgTable(
  "support_requests",
  {
    id: text().primaryKey(),
    organizationId: text().references(() => organization.id, {
      onDelete: "cascade",
    }),
    requesterUserId: text().references(() => user.id, { onDelete: "set null" }),
    requesterEmail: text().notNull(),
    subject: text().notNull(),
    category: text().$type<SupportCategory>().notNull(),
    severity: integer().notNull(),
    status: text().$type<SupportStatus>().notNull().default("open"),
    channel: text().$type<SupportChannel>().notNull(),
    // The organization's plan when the request came in; null without one.
    planAtSubmit: text(),
    // Links the customer gave: one of their agents and one of their cases.
    agentId: text(),
    caseRef: text(),
    incidentRef: text(),
    // The case in Preprocess Support, once one was created.
    supportCaseId: text(),
    // The r+<token>@ address replies thread by.
    replyToken: text().notNull().unique(),
    firstResponseDueAt: timestamp({ withTimezone: true }),
    firstResponseAt: timestamp({ withTimezone: true }),
    firstResponseSolved: boolean().notNull().default(false),
    slaWarnedAt: timestamp({ withTimezone: true }),
    slaBreachedAt: timestamp({ withTimezone: true }),
    solvedAt: timestamp({ withTimezone: true }),
    // When a reply the requester hasn't opened yet arrived, for the app's
    // sidebar notice stack; cleared when they open the request.
    requesterNoticeAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.organizationId, t.createdAt),
    index().on(t.requesterUserId),
    index().on(t.status, t.solvedAt),
    check("support_requests_severity", sql`${t.severity} between 1 and 3`),
    check(
      "support_requests_signed_out",
      sql`${t.organizationId} is not null or ${t.channel} in ('form', 'email')`,
    ),
  ],
);

export const supportMessages = pgTable(
  "support_messages",
  {
    id: text().primaryKey(),
    requestId: text()
      .notNull()
      .references(() => supportRequests.id, { onDelete: "cascade" }),
    organizationId: text().references(() => organization.id, {
      onDelete: "cascade",
    }),
    authorKind: text().$type<SupportAuthorKind>().notNull(),
    authorUserId: text().references(() => user.id, { onDelete: "set null" }),
    // Markdown or plain text.
    body: text().notNull(),
    // How a customer's message came in; null for our replies.
    via: text().$type<SupportChannel>(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.requestId, t.createdAt)],
);

export const supportAttachments = pgTable(
  "support_attachments",
  {
    id: text().primaryKey(),
    // Null until the upload is sent with a new request.
    requestId: text().references(() => supportRequests.id, {
      onDelete: "cascade",
    }),
    messageId: text().references(() => supportMessages.id, {
      onDelete: "set null",
    }),
    organizationId: text().references(() => organization.id, {
      onDelete: "cascade",
    }),
    // Who uploaded it: a user or API key id, or null for an email.
    uploadedBy: text(),
    r2Key: text().notNull(),
    filename: text().notNull(),
    contentType: text().notNull(),
    sizeBytes: integer().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.requestId),
    index().on(t.createdAt),
    check(
      "support_attachments_size",
      sql`${t.sizeBytes} between 0 and ${sql.raw(String(SUPPORT_ATTACHMENT_MAX_BYTES))}`,
    ),
  ],
);
