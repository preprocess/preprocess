CREATE TYPE "public"."deployment_source" AS ENUM('cli', 'github');--> statement-breakpoint
CREATE TYPE "public"."deployment_status" AS ENUM('ready', 'waiting', 'failed');--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"status" "deployment_status" NOT NULL,
	"script_name" text NOT NULL,
	"bundle_sha256" text NOT NULL,
	"sdk_version" text NOT NULL,
	"model" text NOT NULL,
	"reasoning" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"waiting_for" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"git_branch" text,
	"git_commit" text,
	"source" "deployment_source" NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"promoted_at" timestamp with time zone,
	CONSTRAINT "deployments_org_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
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
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_org_id_unique" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "production_branch" text DEFAULT 'main' NOT NULL;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_organization_id_agent_id_agents_organization_id_id_fk" FOREIGN KEY ("organization_id","agent_id") REFERENCES "public"."agents"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_deliveries" ADD CONSTRAINT "secret_deliveries_organization_id_deployment_id_deployments_organization_id_id_fk" FOREIGN KEY ("organization_id","deployment_id") REFERENCES "public"."deployments"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_deliveries" ADD CONSTRAINT "secret_deliveries_organization_id_secret_id_secrets_organization_id_id_fk" FOREIGN KEY ("organization_id","secret_id") REFERENCES "public"."secrets"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_grants" ADD CONSTRAINT "secret_grants_organization_id_secret_id_secrets_organization_id_id_fk" FOREIGN KEY ("organization_id","secret_id") REFERENCES "public"."secrets"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_grants" ADD CONSTRAINT "secret_grants_organization_id_agent_id_agents_organization_id_id_fk" FOREIGN KEY ("organization_id","agent_id") REFERENCES "public"."agents"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deployments_organization_id_agent_id_created_at_index" ON "deployments" USING btree ("organization_id","agent_id","created_at");--> statement-breakpoint
CREATE INDEX "deployments_organization_id_agent_id_promoted_at_index" ON "deployments" USING btree ("organization_id","agent_id","promoted_at") WHERE promoted_at is not null;--> statement-breakpoint
CREATE INDEX "secret_deliveries_organization_id_secret_id_index" ON "secret_deliveries" USING btree ("organization_id","secret_id");--> statement-breakpoint
CREATE INDEX "secret_grants_organization_id_agent_id_index" ON "secret_grants" USING btree ("organization_id","agent_id");--> statement-breakpoint

-- Tenant security for the step 2 tables (see 0001_security.sql).
GRANT SELECT, INSERT, UPDATE, DELETE ON deployments, secret_grants, secret_deliveries TO preprocess_app, preprocess_system;
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['deployments', 'secret_grants', 'secret_deliveries'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (organization_id = current_setting(''app.org_id'', true)) WITH CHECK (organization_id = current_setting(''app.org_id'', true))',
      t);
  END LOOP;
END
$$;
