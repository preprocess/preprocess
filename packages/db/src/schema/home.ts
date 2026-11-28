// First-time cards a person dismissed from the home page (PRE-178), per
// organization, since a person new to one organization is new there again.

import {
  foreignKey,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth.ts";

export const homeDismissals = pgTable(
  "home_dismissals",
  {
    organizationId: text().notNull(),
    userId: text().notNull(),
    card: text().notNull(),
    dismissedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.userId, t.card] }),
    foreignKey({
      columns: [t.organizationId],
      foreignColumns: [organization.id],
    }).onDelete("cascade"),
    foreignKey({ columns: [t.userId], foreignColumns: [user.id] }).onDelete(
      "cascade",
    ),
  ],
);
