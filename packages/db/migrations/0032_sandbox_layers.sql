ALTER TYPE "public"."deployment_status" ADD VALUE 'building';--> statement-breakpoint
CREATE TABLE "sandbox_layers" (
	"organization_id" text NOT NULL,
	"key" text NOT NULL,
	"image" text NOT NULL,
	"bytes" bigint NOT NULL,
	"unpacked_bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sandbox_layers_organization_id_key_pk" PRIMARY KEY("organization_id","key"),
	CONSTRAINT "sandbox_layers_key_in_org" CHECK ("sandbox_layers"."key" LIKE 'org/' || "sandbox_layers"."organization_id" || '/layers/%')
);
--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "sandbox_layer" jsonb;--> statement-breakpoint
ALTER TABLE "sandbox_layers" ADD CONSTRAINT "sandbox_layers_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Tenant security for sandbox layers (see 0001_security.sql).
GRANT SELECT, INSERT, UPDATE, DELETE ON sandbox_layers TO preprocess_app, preprocess_system;
--> statement-breakpoint
ALTER TABLE sandbox_layers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sandbox_layers FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant ON sandbox_layers USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
