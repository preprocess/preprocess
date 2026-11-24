CREATE TYPE "public"."mcp_auth" AS ENUM('none', 'oauth');--> statement-breakpoint
CREATE TYPE "public"."mcp_connection_status" AS ENUM('active', 'needs_reauth', 'revoked');--> statement-breakpoint
CREATE TABLE "mcp_authorizations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"server_id" text NOT NULL,
	"code_verifier" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"created_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"server_id" text NOT NULL,
	"version" integer NOT NULL,
	"key_version" integer NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"status" "mcp_connection_status" NOT NULL,
	"connected_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_connections_serverId_unique" UNIQUE("server_id")
);
--> statement-breakpoint
CREATE TABLE "mcp_grants" (
	"organization_id" text NOT NULL,
	"server_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"granted_by" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_grants_server_id_agent_id_pk" PRIMARY KEY("server_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "mcp_servers" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"slug" text NOT NULL,
	"url" text NOT NULL,
	"auth" "mcp_auth" NOT NULL,
	"oauth_client" jsonb,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_servers_organizationId_slug_unique" UNIQUE("organization_id","slug"),
	CONSTRAINT "mcp_servers_org_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "mcp_authorizations" ADD CONSTRAINT "mcp_authorizations_organization_id_server_id_mcp_servers_organization_id_id_fk" FOREIGN KEY ("organization_id","server_id") REFERENCES "public"."mcp_servers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_connections" ADD CONSTRAINT "mcp_connections_organization_id_server_id_mcp_servers_organization_id_id_fk" FOREIGN KEY ("organization_id","server_id") REFERENCES "public"."mcp_servers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_grants" ADD CONSTRAINT "mcp_grants_organization_id_server_id_mcp_servers_organization_id_id_fk" FOREIGN KEY ("organization_id","server_id") REFERENCES "public"."mcp_servers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_grants" ADD CONSTRAINT "mcp_grants_organization_id_agent_id_agents_organization_id_id_fk" FOREIGN KEY ("organization_id","agent_id") REFERENCES "public"."agents"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_grants_organization_id_agent_id_index" ON "mcp_grants" USING btree ("organization_id","agent_id");--> statement-breakpoint

-- Tenant security for the MCP tables (see 0001_security.sql).
GRANT SELECT, INSERT, UPDATE, DELETE ON mcp_servers, mcp_grants, mcp_connections, mcp_authorizations TO preprocess_app, preprocess_system;
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mcp_servers', 'mcp_grants', 'mcp_connections', 'mcp_authorizations'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (organization_id = current_setting(''app.org_id'', true)) WITH CHECK (organization_id = current_setting(''app.org_id'', true))',
      t);
  END LOOP;
END
$$;
