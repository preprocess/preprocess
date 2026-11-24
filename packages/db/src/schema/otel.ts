// OpenTelemetry export of run logs (design doc 09): one endpoint per
// organization. The headers usually carry the collector's credentials, so
// they are stored like secrets: write-only, under the organization's key.

import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { organization } from "./auth.ts";
import { bytea } from "./columns.ts";

export const otelExports = pgTable("otel_exports", {
  organizationId: text()
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  // OTLP/HTTP base URL; logs go to {endpoint}/v1/logs, traces to /v1/traces.
  endpoint: text().notNull(),
  // The header names, readable; their values only in the ciphertext.
  headerNames: text().array().notNull().default([]),
  keyVersion: integer().notNull(),
  headersCiphertext: bytea().notNull(),
  enabled: boolean().notNull().default(true),
  updatedBy: text().notNull(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
