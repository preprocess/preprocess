CREATE TYPE "public"."guardrail_kind" AS ENUM('network', 'secret', 'mcp', 'spending_limit');--> statement-breakpoint
CREATE TYPE "public"."guardrail_request_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "agent_network_rules" (
	"organization_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"rules" jsonb NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_network_rules_organization_id_agent_id_pk" PRIMARY KEY("organization_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "guardrail_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" "guardrail_kind" NOT NULL,
	"agent_id" text,
	"deployment_id" text,
	"change" jsonb NOT NULL,
	"reason" text,
	"status" "guardrail_request_status" DEFAULT 'pending' NOT NULL,
	"requested_by_type" text NOT NULL,
	"requested_by" text NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_guardrails" ADD COLUMN "network" jsonb DEFAULT '{"allow":[],"block":[]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_network_rules" ADD CONSTRAINT "agent_network_rules_organization_id_agent_id_agents_organization_id_id_fk" FOREIGN KEY ("organization_id","agent_id") REFERENCES "public"."agents"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardrail_requests" ADD CONSTRAINT "guardrail_requests_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardrail_requests" ADD CONSTRAINT "guardrail_requests_organization_id_agent_id_agents_organization_id_id_fk" FOREIGN KEY ("organization_id","agent_id") REFERENCES "public"."agents"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardrail_requests" ADD CONSTRAINT "guardrail_requests_organization_id_deployment_id_deployments_organization_id_id_fk" FOREIGN KEY ("organization_id","deployment_id") REFERENCES "public"."deployments"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guardrail_requests_organization_id_status_index" ON "guardrail_requests" USING btree ("organization_id","status");--> statement-breakpoint

-- Tenant security for the guardrail tables (see 0001_security.sql).
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_network_rules, guardrail_requests TO preprocess_app, preprocess_system;
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['agent_network_rules', 'guardrail_requests'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (organization_id = current_setting(''app.org_id'', true)) WITH CHECK (organization_id = current_setting(''app.org_id'', true))',
      t);
  END LOOP;
END
$$;
