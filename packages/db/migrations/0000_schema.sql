CREATE TYPE "public"."agent_access" AS ENUM('operator', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."audit_actor" AS ENUM('person', 'agent', 'api_key', 'platform');--> statement-breakpoint
CREATE TYPE "public"."case_source" AS ENUM('api', 'app', 'mcp', 'schedule');--> statement-breakpoint
CREATE TYPE "public"."case_status" AS ENUM('queued', 'running', 'waiting', 'halted', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."halt_reason" AS ENUM('credit_exhausted', 'spending_limit_reached');--> statement-breakpoint
CREATE TABLE "agent_grants" (
	"organization_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"group_id" text NOT NULL,
	"access" "agent_access" NOT NULL,
	"granted_by" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_grants_agent_id_group_id_pk" PRIMARY KEY("agent_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"slug" text NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "agents_organizationId_slug_unique" UNIQUE("organization_id","slug"),
	CONSTRAINT "agents_org_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"organization_id" text NOT NULL,
	"group_id" text NOT NULL,
	"user_id" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_members_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_developers" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "groups_organizationId_slug_unique" UNIQUE("organization_id","slug"),
	CONSTRAINT "groups_org_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"organization_id" text NOT NULL,
	"seq" bigint NOT NULL,
	"id" text NOT NULL,
	"occurred_at" timestamp (6) with time zone NOT NULL,
	"actor_type" "audit_actor" NOT NULL,
	"actor_id" text NOT NULL,
	"on_behalf_of" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"case_id" text,
	"request_id" text,
	"ip" "inet",
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prev_hash" "bytea" NOT NULL,
	"hash" "bytea" NOT NULL,
	CONSTRAINT "audit_events_organization_id_seq_pk" PRIMARY KEY("organization_id","seq"),
	CONSTRAINT "audit_events_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "audit_heads" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"seq" bigint NOT NULL,
	"hash" "bytea" NOT NULL,
	"anchored_through" text
);
--> statement-breakpoint
CREATE TABLE "deleted_organizations" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"deleted_at" timestamp with time zone NOT NULL,
	"final_seq" bigint NOT NULL,
	"final_hash" "bytea" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apikey" (
	"id" text PRIMARY KEY NOT NULL,
	"config_id" text DEFAULT 'default' NOT NULL,
	"name" text,
	"start" text,
	"reference_id" text NOT NULL,
	"prefix" text,
	"key" text NOT NULL,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp,
	"enabled" boolean DEFAULT true,
	"rate_limit_enabled" boolean DEFAULT true,
	"rate_limit_time_window" integer DEFAULT 86400000,
	"rate_limit_max" integer DEFAULT 10,
	"request_count" integer DEFAULT 0,
	"remaining" integer,
	"last_request" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"permissions" text,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	"created_by" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deactivated_at" timestamp,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_assignees" (
	"organization_id" text NOT NULL,
	"case_id" text NOT NULL,
	"user_id" text NOT NULL,
	"assigned_by" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_assignees_case_id_user_id_pk" PRIMARY KEY("case_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"deployment_id" text NOT NULL,
	"status" "case_status" NOT NULL,
	"waiting_on_group_id" text,
	"halt_reason" "halt_reason",
	"source" "case_source" NOT NULL,
	"title" text,
	"cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "cases_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "cases_halt_reason_only_when_halted" CHECK (("cases"."status" = 'halted') = ("cases"."halt_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "org_keys" (
	"organization_id" text NOT NULL,
	"version" integer NOT NULL,
	"master_key_id" text NOT NULL,
	"wrapped_key" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "org_keys_organization_id_version_pk" PRIMARY KEY("organization_id","version")
);
--> statement-breakpoint
CREATE TABLE "secrets" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"key_version" integer NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "secrets_organizationId_name_unique" UNIQUE("organization_id","name"),
	CONSTRAINT "secrets_name_format" CHECK ("secrets"."name" ~ '^[A-Z][A-Z0-9_]{0,63}$')
);
--> statement-breakpoint
ALTER TABLE "agent_grants" ADD CONSTRAINT "agent_grants_organization_id_agent_id_agents_organization_id_id_fk" FOREIGN KEY ("organization_id","agent_id") REFERENCES "public"."agents"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_grants" ADD CONSTRAINT "agent_grants_organization_id_group_id_groups_organization_id_id_fk" FOREIGN KEY ("organization_id","group_id") REFERENCES "public"."groups"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_organization_id_group_id_groups_organization_id_id_fk" FOREIGN KEY ("organization_id","group_id") REFERENCES "public"."groups"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assignees" ADD CONSTRAINT "case_assignees_organization_id_case_id_cases_organization_id_id_fk" FOREIGN KEY ("organization_id","case_id") REFERENCES "public"."cases"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_organization_id_agent_id_agents_organization_id_id_fk" FOREIGN KEY ("organization_id","agent_id") REFERENCES "public"."agents"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_organization_id_waiting_on_group_id_groups_organization_id_id_fk" FOREIGN KEY ("organization_id","waiting_on_group_id") REFERENCES "public"."groups"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_keys" ADD CONSTRAINT "org_keys_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_grants_organization_id_group_id_index" ON "agent_grants" USING btree ("organization_id","group_id");--> statement-breakpoint
CREATE INDEX "group_members_organization_id_user_id_index" ON "group_members" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_developers_group" ON "groups" USING btree ("organization_id") WHERE is_developers;--> statement-breakpoint
CREATE INDEX "audit_events_organization_id_occurred_at_index" ON "audit_events" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_organization_id_case_id_index" ON "audit_events" USING btree ("organization_id","case_id");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "apikey_configId_idx" ON "apikey" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "apikey_referenceId_idx" ON "apikey" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "apikey_key_idx" ON "apikey" USING btree ("key");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "case_assignees_organization_id_user_id_index" ON "case_assignees" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "cases_organization_id_waiting_on_group_id_status_index" ON "cases" USING btree ("organization_id","waiting_on_group_id","status");--> statement-breakpoint
CREATE INDEX "cases_organization_id_agent_id_created_at_index" ON "cases" USING btree ("organization_id","agent_id","created_at");