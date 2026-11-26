CREATE TYPE "public"."mcp_transport" AS ENUM('streamable_http', 'sse');--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "transport" "mcp_transport" DEFAULT 'streamable_http' NOT NULL;