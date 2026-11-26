CREATE TYPE "public"."metered_feature" AS ENUM('cases', 'model_usage', 'decide', 'ocr', 'log_bytes');--> statement-breakpoint
CREATE TYPE "public"."seat_role" AS ENUM('operator', 'developer');--> statement-breakpoint
CREATE TABLE "seat_activity" (
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"month" date NOT NULL,
	"role" "seat_role" NOT NULL,
	"first_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seat_activity_organization_id_month_user_id_role_pk" PRIMARY KEY("organization_id","month","user_id","role")
);
--> statement-breakpoint
CREATE TABLE "usage_records" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"feature" "metered_feature" NOT NULL,
	"quantity" bigint NOT NULL,
	"case_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"reported_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "capture_bytes" bigint;--> statement-breakpoint
ALTER TABLE "seat_activity" ADD CONSTRAINT "seat_activity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_activity" ADD CONSTRAINT "seat_activity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_records_organization_id_feature_at_index" ON "usage_records" USING btree ("organization_id","feature","at");--> statement-breakpoint
CREATE INDEX "usage_records_organization_id_case_id_index" ON "usage_records" USING btree ("organization_id","case_id");--> statement-breakpoint
CREATE INDEX "usage_records_unreported" ON "usage_records" USING btree ("at") WHERE reported_at is null;--> statement-breakpoint
-- Tenant security for metering (see 0001_security.sql).
GRANT SELECT, INSERT, UPDATE, DELETE ON usage_records, seat_activity TO preprocess_app, preprocess_system;
--> statement-breakpoint
ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE usage_records FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant ON usage_records USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
--> statement-breakpoint
ALTER TABLE seat_activity ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE seat_activity FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant ON seat_activity USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
