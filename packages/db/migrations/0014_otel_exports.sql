CREATE TABLE "otel_exports" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"endpoint" text NOT NULL,
	"header_names" text[] DEFAULT '{}' NOT NULL,
	"key_version" integer NOT NULL,
	"headers_ciphertext" "bytea" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "otel_exports" ADD CONSTRAINT "otel_exports_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Tenant security for OpenTelemetry export settings (see 0001_security.sql).
GRANT SELECT, INSERT, UPDATE, DELETE ON otel_exports TO preprocess_app, preprocess_system;
--> statement-breakpoint
ALTER TABLE otel_exports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE otel_exports FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant ON otel_exports USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
