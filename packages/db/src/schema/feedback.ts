// Feedback about Preprocess itself (PRE-164): what a person or an agent,
// usually over MCP, tells us is broken, missing or confusing. Each item
// stays in its own organization; on our cloud it is also emailed to us
// (apps/api/src/routes/feedback.ts). Self-hosted installs keep it locally.

import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { organization, user } from "./auth.ts";

export const FEEDBACK_CATEGORIES = [
  "bug",
  "idea",
  "question",
  "other",
] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_MESSAGE_MAX = 5000;
export const FEEDBACK_CLIENT_MAX = 100;

export const feedback = pgTable(
  "feedback",
  {
    id: text().primaryKey(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    createdByUserId: text().references(() => user.id, { onDelete: "set null" }),
    // The organization API key that sent it, for feedback over the API or MCP.
    apiKeyId: text(),
    category: text().$type<FeedbackCategory>().notNull(),
    message: text().notNull(),
    // An agent and a case in this organization it is about.
    agentId: text(),
    caseId: text(),
    // What sent it, as the caller named itself (an MCP client, say).
    client: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.organizationId, t.createdAt),
    check(
      "feedback_category",
      sql`${t.category} in ('bug', 'idea', 'question', 'other')`,
    ),
    check(
      "feedback_client_length",
      sql`char_length(${t.client}) <= ${sql.raw(String(FEEDBACK_CLIENT_MAX))}`,
    ),
  ],
);
