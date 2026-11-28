CREATE TABLE "organization_purge_objects" (
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"agent" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "organization_purge_objects_organization_id_kind_agent_name_pk" PRIMARY KEY("organization_id","kind","agent","name")
);
--> statement-breakpoint
CREATE TABLE "organization_purges" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "organization_purges_open" ON "organization_purges" USING btree ("requested_at") WHERE completed_at is null;--> statement-breakpoint
-- Tenant security for the purge tables (see 0001_security.sql). The purge
-- runs as the system role once the organization is gone; the tenant policy
-- keeps them out of every other organization's reach all the same.
GRANT SELECT, INSERT, UPDATE, DELETE ON organization_purges, organization_purge_objects TO preprocess_app, preprocess_system;--> statement-breakpoint
ALTER TABLE organization_purges ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE organization_purges FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant ON organization_purges USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE organization_purge_objects ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE organization_purge_objects FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant ON organization_purge_objects USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
