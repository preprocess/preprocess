CREATE TABLE "sso_domains" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"domain" text NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"checked_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "sign_in_method" text;--> statement-breakpoint
ALTER TABLE "sso_provider" ADD COLUMN "metadata_url" text;--> statement-breakpoint
ALTER TABLE "sso_provider" ADD COLUMN "metadata_read_at" timestamp;--> statement-breakpoint
ALTER TABLE "sso_provider" ADD COLUMN "certificate_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "sso_provider" ADD COLUMN "default_group_id" text;--> statement-breakpoint
ALTER TABLE "sso_provider" ADD COLUMN "test_id" text;--> statement-breakpoint
ALTER TABLE "sso_provider" ADD COLUMN "test_started_by" text;--> statement-breakpoint
ALTER TABLE "sso_provider" ADD COLUMN "test_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "sso_provider" ADD COLUMN "last_test" text;--> statement-breakpoint
ALTER TABLE "sso_domains" ADD CONSTRAINT "sso_domains_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sso_domains_org_domain" ON "sso_domains" USING btree ("organization_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "sso_domains_verified" ON "sso_domains" USING btree ("domain") WHERE status = 'verified';--> statement-breakpoint
-- Tenant security for sso_domains (see 0001_security.sql). routes/sso.ts and
-- the auth hooks read and write it on DB_SYSTEM, which also checks that a
-- domain is verified for one organization at most.
GRANT SELECT, INSERT, UPDATE, DELETE ON sso_domains TO preprocess_app, preprocess_system;--> statement-breakpoint
ALTER TABLE sso_domains ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE sso_domains FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant ON sso_domains USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));--> statement-breakpoint
-- Connections made before domains had their own rows (0046): one row per
-- domain, verified when the connection's domains were. The connection then
-- lists only its verified domains, so sign-in by email reaches it only
-- through those, and counts as verified for the SSO plugin: which domains
-- may sign in is decided by sso_domains (apps/api/src/auth.ts).
INSERT INTO sso_domains (id, organization_id, domain, token, status, verified_at, created_by)
SELECT 'ssd_' || replace(gen_random_uuid()::text, '-', ''), p.organization_id, d.domain,
  replace(gen_random_uuid()::text, '-', ''),
  CASE WHEN p.domain_verified THEN 'verified' ELSE 'pending' END,
  CASE WHEN p.domain_verified THEN now() END,
  'platform:migration'
FROM sso_provider p
CROSS JOIN LATERAL (
  SELECT DISTINCT lower(trim(x)) AS domain FROM unnest(string_to_array(p.domain, ',')) AS x
) d
WHERE p.organization_id IS NOT NULL AND d.domain <> ''
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE sso_provider SET
  domain = CASE WHEN domain_verified THEN domain ELSE 'unverified.invalid' END,
  domain_verified = true;
