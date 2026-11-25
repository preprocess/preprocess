ALTER TABLE "cases" ADD COLUMN "review_fields" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "review_since" timestamp with time zone;