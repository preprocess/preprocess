// The license key an Owner uploaded on a self-hosted install (spec 16). One
// row for the whole install, not per organization, so not tenant-scoped: only
// the system role reads and writes it. Only keys that verified are stored.

import { sql } from "drizzle-orm";
import { boolean, check, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth.ts";

export const installLicense = pgTable(
  "install_license",
  {
    id: boolean().primaryKey().default(true),
    key: text().notNull(),
    uploadedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    uploadedBy: text().references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [check("install_license_one_row", sql`${t.id}`)],
);
