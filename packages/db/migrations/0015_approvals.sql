CREATE TABLE "case_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"case_id" text NOT NULL,
	"level" text NOT NULL,
	"target" text NOT NULL,
	"group_id" text,
	"status" text NOT NULL,
	"payload" jsonb,
	"reason" text,
	"requested_at" timestamp with time zone NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "case_approvals" ADD CONSTRAINT "case_approvals_organization_id_case_id_cases_organization_id_id_fk" FOREIGN KEY ("organization_id","case_id") REFERENCES "public"."cases"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_approvals" ADD CONSTRAINT "case_approvals_organization_id_group_id_groups_organization_id_id_fk" FOREIGN KEY ("organization_id","group_id") REFERENCES "public"."groups"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_approvals_organization_id_status_group_id_index" ON "case_approvals" USING btree ("organization_id","status","group_id");--> statement-breakpoint
CREATE INDEX "case_approvals_organization_id_case_id_index" ON "case_approvals" USING btree ("organization_id","case_id");
-- Tenant security for approvals (see 0001_security.sql).
GRANT SELECT, INSERT, UPDATE, DELETE ON case_approvals TO preprocess_app, preprocess_system;
--> statement-breakpoint
ALTER TABLE case_approvals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE case_approvals FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant ON case_approvals USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
