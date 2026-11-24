CREATE TABLE "organization_guardrails" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"spending_limit_micro_usd" bigint,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_guardrails" ADD CONSTRAINT "organization_guardrails_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Tenant security for organization_guardrails (see 0001_security.sql).
ALTER TABLE "organization_guardrails" ADD CONSTRAINT "organization_guardrails_spending_limit_positive" CHECK (spending_limit_micro_usd IS NULL OR spending_limit_micro_usd >= 0);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON organization_guardrails TO preprocess_app, preprocess_system;
--> statement-breakpoint
ALTER TABLE organization_guardrails ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organization_guardrails FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant ON organization_guardrails USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
