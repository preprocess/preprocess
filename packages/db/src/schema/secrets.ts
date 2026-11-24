// Envelope-encrypted organization secrets (design doc 01). Values are
// write-only through the API; which agents receive each one is step 2's
// secret_grants (doc 03).

import {
  check,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { organization } from "./auth.ts";
import { bytea } from "./columns.ts";

export const orgKeys = pgTable(
  "org_keys",
  {
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    masterKeyId: text().notNull(),
    wrappedKey: bytea().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    retiredAt: timestamp({ withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.version] })],
);

export const secrets = pgTable(
  "secrets",
  {
    id: text().primaryKey(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text().notNull(),
    version: integer().notNull(),
    keyVersion: integer().notNull(),
    ciphertext: bytea().notNull(),
    updatedBy: text().notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.organizationId, t.name),
    check("secrets_name_format", sql`${t.name} ~ '^[A-Z][A-Z0-9_]{0,63}$'`),
  ],
);
