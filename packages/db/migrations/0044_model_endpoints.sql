CREATE TABLE "model_endpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"model" text NOT NULL,
	"kind" text NOT NULL,
	"label" text,
	"base_model" text,
	"url" text NOT NULL,
	"provider_model" text NOT NULL,
	"key_version" integer,
	"key_ciphertext" "bytea",
	"checkpoint" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_endpoints_organizationId_model_unique" UNIQUE("organization_id","model"),
	CONSTRAINT "model_endpoints_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "model_endpoints_kind" CHECK ("model_endpoints"."kind" in ('override', 'model'))
);
--> statement-breakpoint
ALTER TABLE "model_endpoints" ADD CONSTRAINT "model_endpoints_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Tenant security (see 0001_security.sql).
GRANT SELECT, INSERT, UPDATE, DELETE ON model_endpoints TO preprocess_app, preprocess_system;
--> statement-breakpoint
ALTER TABLE model_endpoints ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE model_endpoints FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant ON model_endpoints USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
