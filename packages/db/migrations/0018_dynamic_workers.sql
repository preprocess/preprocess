ALTER TABLE "secret_deliveries" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "secret_deliveries" CASCADE;--> statement-breakpoint
ALTER TABLE "deployments" DROP CONSTRAINT "deployments_script_name_unique";--> statement-breakpoint
ALTER TABLE "outbox" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
-- Secrets reach agent code when it loads (doc 03), so nothing re-syncs them.
DELETE FROM "outbox" WHERE "kind" = 'secret.sync';--> statement-breakpoint
DROP TYPE "public"."outbox_kind";--> statement-breakpoint
CREATE TYPE "public"."outbox_kind" AS ENUM('case.start', 'webhook', 'email', 'eval.start');--> statement-breakpoint
ALTER TABLE "outbox" ALTER COLUMN "kind" SET DATA TYPE "public"."outbox_kind" USING "kind"::"public"."outbox_kind";--> statement-breakpoint
ALTER TABLE "deployments" DROP COLUMN "script_name";