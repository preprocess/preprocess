CREATE TYPE "public"."github_build_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'timed_out', 'superseded');--> statement-breakpoint
CREATE TABLE "github_builds" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"link_id" text NOT NULL,
	"agent_slug" text NOT NULL,
	"branch" text NOT NULL,
	"commit" text NOT NULL,
	"status" "github_build_status" NOT NULL,
	"deployment_id" text,
	"error" text,
	"log" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "github_installations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"installation_id" bigint NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"suspended_at" timestamp with time zone,
	CONSTRAINT "github_installations_installationId_unique" UNIQUE("installation_id"),
	CONSTRAINT "github_installations_org_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "github_links" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"repository_id" text NOT NULL,
	"agent_slug" text NOT NULL,
	"branch" text,
	"directory" text DEFAULT '' NOT NULL,
	"entry" text DEFAULT 'src/index.ts' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_links_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "github_links_organizationId_agentSlug_unique" UNIQUE("organization_id","agent_slug")
);
--> statement-breakpoint
CREATE TABLE "github_repositories" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"installation_id" text NOT NULL,
	"repository_id" bigint NOT NULL,
	"full_name" text NOT NULL,
	"default_branch" text,
	"private" boolean NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "github_repositories_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "github_repositories_installationId_repositoryId_unique" UNIQUE("installation_id","repository_id")
);
--> statement-breakpoint
ALTER TABLE "github_builds" ADD CONSTRAINT "github_builds_organization_id_link_id_github_links_organization_id_id_fk" FOREIGN KEY ("organization_id","link_id") REFERENCES "public"."github_links"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_builds" ADD CONSTRAINT "github_builds_organization_id_deployment_id_deployments_organization_id_id_fk" FOREIGN KEY ("organization_id","deployment_id") REFERENCES "public"."deployments"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_links" ADD CONSTRAINT "github_links_organization_id_repository_id_github_repositories_organization_id_id_fk" FOREIGN KEY ("organization_id","repository_id") REFERENCES "public"."github_repositories"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_repositories" ADD CONSTRAINT "github_repositories_organization_id_installation_id_github_installations_organization_id_id_fk" FOREIGN KEY ("organization_id","installation_id") REFERENCES "public"."github_installations"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_builds_organization_id_agent_slug_created_at_index" ON "github_builds" USING btree ("organization_id","agent_slug","created_at");--> statement-breakpoint
CREATE INDEX "github_builds_link_id_branch_status_index" ON "github_builds" USING btree ("link_id","branch","status");--> statement-breakpoint
CREATE INDEX "github_links_organization_id_repository_id_index" ON "github_links" USING btree ("organization_id","repository_id");
-- Tenant security for the GitHub App tables (see 0001_security.sql).
GRANT SELECT, INSERT, UPDATE, DELETE ON github_installations, github_repositories, github_links, github_builds TO preprocess_app, preprocess_system;
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['github_installations', 'github_repositories', 'github_links', 'github_builds'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant ON %I USING (organization_id = current_setting(''app.org_id'', true)) WITH CHECK (organization_id = current_setting(''app.org_id'', true))',
      t);
  END LOOP;
END
$$;
