ALTER TABLE "user" ADD COLUMN "email_notifications" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "waiting_since" timestamp with time zone;--> statement-breakpoint
GRANT SELECT ("email_notifications") ON "user" TO preprocess_app;
