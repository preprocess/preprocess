CREATE TABLE "agent_memories" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"case_id" text NOT NULL,
	"text" text NOT NULL,
	"reason" text,
	"status" text NOT NULL,
	"proposed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "agent_memories_organizationId_caseId_text_unique" UNIQUE("organization_id","case_id","text")
);
--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "memories" jsonb;--> statement-breakpoint
ALTER TABLE "agent_memories" ADD CONSTRAINT "agent_memories_organization_id_agent_id_agents_organization_id_id_fk" FOREIGN KEY ("organization_id","agent_id") REFERENCES "public"."agents"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_memories_organization_id_agent_id_status_index" ON "agent_memories" USING btree ("organization_id","agent_id","status");--> statement-breakpoint
CREATE INDEX "agent_memories_organization_id_status_index" ON "agent_memories" USING btree ("organization_id","status");--> statement-breakpoint
-- Tenant security for memories (see 0001_security.sql).
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_memories TO preprocess_app, preprocess_system;
--> statement-breakpoint
ALTER TABLE agent_memories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE agent_memories FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant ON agent_memories USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
