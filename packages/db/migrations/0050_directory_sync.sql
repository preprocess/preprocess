CREATE TABLE "directory_sync" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"token_credential_id" text,
	"token_last4" text,
	"last_sync_at" timestamp with time zone,
	"sync_started_at" timestamp with time zone,
	"sync_received" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "scim_external_id" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "synced_removed_members" integer;--> statement-breakpoint
ALTER TABLE "directory_sync" ADD CONSTRAINT "directory_sync_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Synced groups keep the SCIM Group's externalId, so a group the directory
-- sends again after deleting it re-links (scim.ts).
UPDATE "groups" SET "scim_external_id" = "scim_group"."external_id" FROM "scim_group" WHERE "scim_group"."id" = "groups"."scim_group_id";--> statement-breakpoint
-- Each organization's latest SCIM write so far, as its last sync.
INSERT INTO "directory_sync" ("organization_id", "last_sync_at")
SELECT "s"."provisioning_domain_id", max("s"."updated_at") AT TIME ZONE 'UTC'
FROM (
  SELECT "provisioning_domain_id", "updated_at" FROM "scim_user"
  UNION ALL
  SELECT "provisioning_domain_id", "updated_at" FROM "scim_group"
) "s"
WHERE "s"."provisioning_domain_id" IN (SELECT "id" FROM "organization")
GROUP BY "s"."provisioning_domain_id";--> statement-breakpoint
-- Tenant security for directory_sync (see 0001_security.sql). SCIM writes and
-- the directory sync settings run as the system role.
GRANT SELECT, INSERT, UPDATE, DELETE ON directory_sync TO preprocess_app, preprocess_system;--> statement-breakpoint
ALTER TABLE directory_sync ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE directory_sync FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant ON directory_sync USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
