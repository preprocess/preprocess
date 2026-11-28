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
-- Not tenant-scoped: Better Auth's SSO plugin table, read and written only
-- through its adapter and routes/sso.ts on DB_SYSTEM (see 0001_security.sql).
GRANT SELECT, INSERT, UPDATE, DELETE ON sso_provider TO preprocess_system;
