CREATE TABLE "usage_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"feature" text NOT NULL,
	"seq" integer NOT NULL,
	"quantity" bigint NOT NULL,
	"remainder" bigint NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"reported_at" timestamp with time zone,
	CONSTRAINT "usage_reports_organizationId_feature_seq_unique" UNIQUE("organization_id","feature","seq")
);
--> statement-breakpoint
ALTER TABLE "usage_records" ADD COLUMN "report_id" text;--> statement-breakpoint
ALTER TABLE "usage_reports" ADD CONSTRAINT "usage_reports_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_reports_unreported" ON "usage_reports" USING btree ("at") WHERE reported_at is null;--> statement-breakpoint
-- Tenant security for usage reports (see 0001_security.sql).
GRANT SELECT, INSERT, UPDATE, DELETE ON usage_reports TO preprocess_app, preprocess_system;
--> statement-breakpoint
ALTER TABLE usage_reports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE usage_reports FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant ON usage_reports USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
