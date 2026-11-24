ALTER TABLE "secrets" ADD CONSTRAINT "secrets_org_id_unique" UNIQUE("organization_id","id");--> statement-breakpoint
CREATE TABLE "secret_deliveries" (
	"organization_id" text NOT NULL,
	"deployment_id" text NOT NULL,
	"secret_id" text NOT NULL,
	"secret_version" integer NOT NULL,
	"delivered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "secret_deliveries_deployment_id_secret_id_pk" PRIMARY KEY("deployment_id","secret_id")
);
--> statement-breakpoint
CREATE TABLE "secret_grants" (
	"organization_id" text NOT NULL,
	"secret_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"granted_by" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "secret_grants_secret_id_agent_id_pk" PRIMARY KEY("secret_id","agent_id")
);
--> statement-breakpoint
ALTER TABLE "secret_deliveries" ADD CONSTRAINT "secret_deliveries_organization_id_deployment_id_deployments_organization_id_id_fk" FOREIGN KEY ("organization_id","deployment_id") REFERENCES "public"."deployments"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_deliveries" ADD CONSTRAINT "secret_deliveries_organization_id_secret_id_secrets_organization_id_id_fk" FOREIGN KEY ("organization_id","secret_id") REFERENCES "public"."secrets"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_grants" ADD CONSTRAINT "secret_grants_organization_id_secret_id_secrets_organization_id_id_fk" FOREIGN KEY ("organization_id","secret_id") REFERENCES "public"."secrets"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_grants" ADD CONSTRAINT "secret_grants_organization_id_agent_id_agents_organization_id_id_fk" FOREIGN KEY ("organization_id","agent_id") REFERENCES "public"."agents"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "secret_deliveries_organization_id_secret_id_index" ON "secret_deliveries" USING btree ("organization_id","secret_id");--> statement-breakpoint
CREATE INDEX "secret_grants_organization_id_agent_id_index" ON "secret_grants" USING btree ("organization_id","agent_id");--> statement-breakpoint

-- Tenant security for the secret delivery tables (see 0001_security.sql).
GRANT SELECT, INSERT, UPDATE, DELETE ON secret_grants, secret_deliveries TO preprocess_app, preprocess_system;
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['secret_grants', 'secret_deliveries'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (organization_id = current_setting(''app.org_id'', true)) WITH CHECK (organization_id = current_setting(''app.org_id'', true))',
      t);
  END LOOP;
END
$$;
