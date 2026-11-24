import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Every tenant-owned row carries its organization (spec 15, multi-tenancy).
export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const members = pgTable("members", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role", { enum: ["owner", "admin", "member"] }).notNull(),
});
