CREATE TABLE "free_credit_grants" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"card_fingerprint" text,
	"granted" boolean NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "free_credit_grants_cardFingerprint_unique" UNIQUE("card_fingerprint")
);--> statement-breakpoint
-- Not tenant-scoped: only the system role reads and writes it (see 0001_security.sql).
GRANT SELECT, INSERT, DELETE ON free_credit_grants TO preprocess_system;
