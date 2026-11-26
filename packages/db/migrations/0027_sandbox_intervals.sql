CREATE TYPE "public"."sandbox_end" AS ENUM('sleep', 'destroy', 'crash', 'lost');--> statement-breakpoint
CREATE TYPE "public"."sandbox_kind" AS ENUM('build', 'render', 'case');--> statement-breakpoint
ALTER TYPE "public"."metered_feature" ADD VALUE 'sandbox';--> statement-breakpoint
CREATE TABLE "sandbox_intervals" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"sandbox_id" text NOT NULL,
	"seq" integer NOT NULL,
	"agent" text,
	"case_id" text,
	"kind" "sandbox_kind" NOT NULL,
	"size" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" "sandbox_end",
	CONSTRAINT "sandbox_intervals_sandboxId_seq_unique" UNIQUE("sandbox_id","seq")
);
--> statement-breakpoint
ALTER TABLE "sandbox_intervals" ADD CONSTRAINT "sandbox_intervals_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sandbox_intervals_organization_id_started_at_index" ON "sandbox_intervals" USING btree ("organization_id","started_at");--> statement-breakpoint
CREATE INDEX "sandbox_intervals_open" ON "sandbox_intervals" USING btree ("last_seen_at") WHERE ended_at is null;--> statement-breakpoint
-- Tenant security for sandbox intervals (see 0001_security.sql).
GRANT SELECT, INSERT, UPDATE, DELETE ON sandbox_intervals TO preprocess_app, preprocess_system;
--> statement-breakpoint
ALTER TABLE sandbox_intervals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sandbox_intervals FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant ON sandbox_intervals USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
