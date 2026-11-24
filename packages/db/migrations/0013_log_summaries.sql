CREATE TYPE "public"."log_subject" AS ENUM('case', 'deployment');--> statement-breakpoint
CREATE TABLE "log_summaries" (
	"organization_id" text NOT NULL,
	"subject_kind" "log_subject" NOT NULL,
	"subject_id" text NOT NULL,
	"events" bigint DEFAULT 0 NOT NULL,
	"errors" bigint DEFAULT 0 NOT NULL,
	"warnings" bigint DEFAULT 0 NOT NULL,
	"last_error" jsonb,
	"first_at" timestamp with time zone NOT NULL,
	"last_at" timestamp with time zone NOT NULL,
	CONSTRAINT "log_summaries_organization_id_subject_kind_subject_id_pk" PRIMARY KEY("organization_id","subject_kind","subject_id")
);
--> statement-breakpoint
ALTER TABLE "log_summaries" ADD CONSTRAINT "log_summaries_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Tenant security for log summaries (see 0001_security.sql).
GRANT SELECT, INSERT, UPDATE, DELETE ON log_summaries TO preprocess_app, preprocess_system;
--> statement-breakpoint
ALTER TABLE log_summaries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE log_summaries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant ON log_summaries USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
