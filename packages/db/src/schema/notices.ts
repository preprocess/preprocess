// Announcements a person dismissed from the sidebar notice stack. Per person,
// not per organization, so not tenant-scoped: only the system role reads and
// writes it, always for the signed-in user.

import { pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth.ts";

export const noticeDismissals = pgTable(
  "notice_dismissals",
  {
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    noticeId: text().notNull(),
    dismissedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.noticeId] })],
);
