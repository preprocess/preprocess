-- sso_provider (0046) holds tenant rows: row-level security holds for every
-- role but DB_SYSTEM, and tenant code may see which connection an
-- organization has, never its SAML or OIDC configuration (the OIDC client
-- secret lives there).
GRANT SELECT (id, issuer, provider_id, organization_id, domain, domain_verified, enforced, jit) ON sso_provider TO preprocess_app;--> statement-breakpoint
ALTER TABLE sso_provider ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE sso_provider FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant ON sso_provider USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
