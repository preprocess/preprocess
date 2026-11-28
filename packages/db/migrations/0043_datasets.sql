CREATE TABLE "datasets" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"name" text NOT NULL,
	"query" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "datasets_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "datasets_organizationId_agentId_name_unique" UNIQUE("organization_id","agent_id","name")
);
--> statement-breakpoint
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_organization_id_agent_id_agents_organization_id_id_fk" FOREIGN KEY ("organization_id","agent_id") REFERENCES "public"."agents"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Tenant security for datasets (see 0001_security.sql).
GRANT SELECT, INSERT, UPDATE, DELETE ON datasets TO preprocess_app, preprocess_system;
--> statement-breakpoint
ALTER TABLE datasets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE datasets FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant ON datasets USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
