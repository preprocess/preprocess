CREATE TABLE "case_search" (
	"organization_id" text NOT NULL,
	"case_id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"environment" "deployment_environment" NOT NULL,
	"title" text,
	"input" text NOT NULL,
	"input_hash" text NOT NULL,
	"answer" text,
	"answers" jsonb,
	"changed" text[] DEFAULT '{}'::text[] NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"document" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce(title, '')), 'A') || setweight(jsonb_to_tsvector('simple', coalesce(answers, '{}'::jsonb), '["string", "numeric"]'), 'A') || setweight(to_tsvector('simple', coalesce(answer, '')), 'B') || setweight(to_tsvector('simple', input), 'C')) STORED NOT NULL
);
--> statement-breakpoint
ALTER TABLE "case_search" ADD CONSTRAINT "case_search_organization_id_case_id_cases_organization_id_id_fk" FOREIGN KEY ("organization_id","case_id") REFERENCES "public"."cases"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_search_organization_id_agent_id_environment_completed_at_index" ON "case_search" USING btree ("organization_id","agent_id","environment","completed_at");--> statement-breakpoint
CREATE INDEX "case_search_organization_id_agent_id_input_hash_index" ON "case_search" USING btree ("organization_id","agent_id","input_hash");--> statement-breakpoint
CREATE INDEX "case_search_document" ON "case_search" USING gin ("document");--> statement-breakpoint
-- Tenant security for case search (see 0001_security.sql). Retention deletes
-- rows through the case's foreign key.
GRANT SELECT, INSERT, UPDATE, DELETE ON case_search TO preprocess_app, preprocess_system;
--> statement-breakpoint
ALTER TABLE case_search ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE case_search FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant ON case_search USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
