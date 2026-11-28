// The email domains an organization signs in through its SSO connection
// (spec 13, PRE-137). Each proves itself by a DNS TXT record
// (_preprocess.<domain> = preprocess-verification=<token>). Only verified
// domains route sign-in to the connection, and a domain is verified for one
// organization at most. Domains outlive the connection: removing it keeps
// them.

import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth.ts";

export type SsoDomainStatus = "pending" | "verified" | "failed";
export type SsoDomainFailure =
  "record_missing" | "value_mismatch" | "dns_error";

export const ssoDomains = pgTable(
  "sso_domains",
  {
    id: text().primaryKey(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    domain: text().notNull(),
    token: text().notNull(),
    status: text().$type<SsoDomainStatus>().notNull().default("pending"),
    // Why the last check failed; null unless status is failed.
    failureReason: text().$type<SsoDomainFailure>(),
    checkedAt: timestamp({ withTimezone: true }),
    verifiedAt: timestamp({ withTimezone: true }),
    createdBy: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sso_domains_org_domain").on(t.organizationId, t.domain),
    uniqueIndex("sso_domains_verified")
      .on(t.domain)
      .where(sql`status = 'verified'`),
  ],
);
