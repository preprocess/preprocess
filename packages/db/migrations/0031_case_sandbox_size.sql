CREATE TYPE "public"."sandbox_size" AS ENUM('small', 'medium', 'large');--> statement-breakpoint
ALTER TYPE "public"."guardrail_kind" ADD VALUE 'sandbox_size';--> statement-breakpoint
ALTER TABLE "organization_guardrails" ADD COLUMN "sandbox_max_size" "sandbox_size";