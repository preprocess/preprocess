// Directory sync state per organization (PRE-138), beside Better Auth's SCIM
// tables, whose shape the plugin owns. It keeps the current token's last four
// characters (scim_managed_credential holds only a digest) and the latest
// sync. An identity provider sends a sync as a run of SCIM writes with no
// start or end, so a sync is writes less than two minutes apart (scim.ts).

import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { organization } from "./auth.ts";

export const directorySync = pgTable("directory_sync", {
  organizationId: text()
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  tokenCredentialId: text(),
  tokenLast4: text(),
  lastSyncAt: timestamp({ withTimezone: true }),
  syncStartedAt: timestamp({ withTimezone: true }),
  syncReceived: integer().notNull().default(0),
});
