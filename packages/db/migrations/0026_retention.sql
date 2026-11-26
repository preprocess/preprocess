CREATE TABLE "organization_retention" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"documents_days" integer,
	"run_capture_days" integer,
	"run_logs_days" integer,
	"cases_days" integer,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_retention_documents_days" CHECK ((documents_days IS NULL OR documents_days >= 7)),
	CONSTRAINT "organization_retention_run_capture_days" CHECK ((run_capture_days IS NULL OR run_capture_days >= 7)),
	CONSTRAINT "organization_retention_run_logs_days" CHECK ((run_logs_days IS NULL OR run_logs_days >= 7)),
	CONSTRAINT "organization_retention_cases_days" CHECK ((cases_days IS NULL OR cases_days >= 7))
);
--> statement-breakpoint
CREATE TABLE "retention_sweeps" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"days" integer NOT NULL,
	"cutoff" timestamp with time zone NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"audited_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "capture_purged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "logs_purged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organization_retention" ADD CONSTRAINT "organization_retention_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_sweeps" ADD CONSTRAINT "retention_sweeps_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "retention_sweeps_open" ON "retention_sweeps" USING btree ("organization_id","kind") WHERE audited_at is null;
-- Tenant security for the retention tables (see 0001_security.sql). The
-- system role reads every organization's periods for the daily sweep.
GRANT SELECT, INSERT, UPDATE, DELETE ON organization_retention, retention_sweeps TO preprocess_app, preprocess_system;
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['organization_retention', 'retention_sweeps'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (organization_id = current_setting(''app.org_id'', true)) WITH CHECK (organization_id = current_setting(''app.org_id'', true))',
      t);
  END LOOP;
END
$$;
