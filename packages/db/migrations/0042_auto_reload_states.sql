CREATE TABLE "auto_reload_states" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"failed_at" timestamp with time zone,
	"failed_reason" text,
	"cap_reached_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auto_reload_states" ADD CONSTRAINT "auto_reload_states_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Tenant security (see 0001_security.sql).
GRANT SELECT, INSERT, UPDATE, DELETE ON auto_reload_states TO preprocess_app, preprocess_system;
--> statement-breakpoint
ALTER TABLE auto_reload_states ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE auto_reload_states FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant ON auto_reload_states USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
