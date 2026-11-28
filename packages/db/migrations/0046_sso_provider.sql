CREATE TABLE "sso_provider" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"oidc_config" text,
	"saml_config" text,
	"user_id" text,
	"provider_id" text NOT NULL,
	"organization_id" text,
	"domain" text NOT NULL,
	"domain_verified" boolean,
	"enforced" boolean DEFAULT false NOT NULL,
	"jit" boolean DEFAULT true NOT NULL,
	CONSTRAINT "sso_provider_provider_id_unique" UNIQUE("provider_id")
);
--> statement-breakpoint
ALTER TABLE "sso_provider" ADD CONSTRAINT "sso_provider_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sso_provider_organizationId_idx" ON "sso_provider" USING btree ("organization_id");--> statement-breakpoint
-- Better Auth's SSO plugin table, read and written through its adapter and
-- routes/sso.ts on DB_SYSTEM (see 0001_security.sql). Tenant rows all the
-- same, so row-level security holds for any other role.
GRANT SELECT, INSERT, UPDATE, DELETE ON sso_provider TO preprocess_system;--> statement-breakpoint
-- Tenant code may see which connection an organization has, never its SAML or
-- OIDC configuration (the OIDC client secret lives there).
GRANT SELECT (id, issuer, provider_id, organization_id, domain, domain_verified, enforced, jit) ON sso_provider TO preprocess_app;--> statement-breakpoint
ALTER TABLE sso_provider ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE sso_provider FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant ON sso_provider USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
