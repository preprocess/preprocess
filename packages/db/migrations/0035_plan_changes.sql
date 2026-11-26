CREATE TABLE "demoted_seats" (
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"group_id" text NOT NULL,
	"demoted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demoted_seats_organization_id_user_id_group_id_pk" PRIMARY KEY("organization_id","user_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "plan_changes" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"plan" text NOT NULL,
	"at" timestamp with time zone,
	"keep" jsonb,
	"reason" text,
	"requested_by" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"warned_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "demoted_seats" ADD CONSTRAINT "demoted_seats_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demoted_seats" ADD CONSTRAINT "demoted_seats_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_changes" ADD CONSTRAINT "plan_changes_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Tenant security (see 0001_security.sql).
GRANT SELECT, INSERT, UPDATE, DELETE ON plan_changes, demoted_seats TO preprocess_app, preprocess_system;
--> statement-breakpoint
ALTER TABLE plan_changes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE plan_changes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant ON plan_changes USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
--> statement-breakpoint
ALTER TABLE demoted_seats ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE demoted_seats FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant ON demoted_seats USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
