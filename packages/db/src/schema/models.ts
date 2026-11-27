// Model endpoints an organization registers (design doc 10, spec 12a): an
// OpenAI-compatible URL that serves a catalogue model in place of its
// provider (override), or a new organization model "org:<slug>" such as a
// trained checkpoint (model). The API key is envelope-encrypted with the
// organization's data key, like secrets (design doc 01).

import {
  check,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { organization } from "./auth.ts";
import { bytea } from "./columns.ts";

export const modelEndpoints = pgTable(
  "model_endpoints",
  {
    id: text().primaryKey(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // A catalogue id for an override, "org:<slug>" for an organization model.
    model: text().notNull(),
    kind: text().$type<"override" | "model">().notNull(),
    // An organization model's shown name and the catalogue model it was
    // trained from, which prices it.
    label: text(),
    baseModel: text(),
    url: text().notNull(),
    // The name sent as "model" on every request.
    providerModel: text().notNull(),
    keyVersion: integer(),
    keyCiphertext: bytea(),
    checkpoint: text(),
    createdBy: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.organizationId, t.model),
    unique("model_endpoints_org_id_unique").on(t.organizationId, t.id),
    check("model_endpoints_kind", sql`${t.kind} in ('override', 'model')`),
  ],
);
