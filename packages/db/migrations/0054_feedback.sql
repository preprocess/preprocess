CREATE TABLE "feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by_user_id" text,
	"api_key_id" text,
	"category" text NOT NULL,
	"message" text NOT NULL,
	"agent_id" text,
	"case_id" text,
	"client" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_category" CHECK ("feedback"."category" in ('bug', 'idea', 'question', 'other')),
	CONSTRAINT "feedback_client_length" CHECK (char_length("feedback"."client") <= 100)
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_organization_id_created_at_index" ON "feedback" USING btree ("organization_id","created_at");--> statement-breakpoint-- Tenant security for feedback (see 0001_security.sql). Every row belongs to
-- one organization, which alone can read it.
GRANT SELECT, INSERT, UPDATE, DELETE ON feedback TO preprocess_app, preprocess_system;--> statement-breakpoint
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE feedback FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant ON feedback USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
