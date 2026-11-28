CREATE TABLE "install_license" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"key" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by" text,
	CONSTRAINT "install_license_one_row" CHECK ("install_license"."id")
);
--> statement-breakpoint
ALTER TABLE "install_license" ADD CONSTRAINT "install_license_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Not tenant-scoped: one row for the whole self-hosted install, so only the
-- system role reads and writes it (see 0001_security.sql).
GRANT SELECT, INSERT, UPDATE ON install_license TO preprocess_system;
