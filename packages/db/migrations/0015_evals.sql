CREATE TYPE "public"."eval_result_status" AS ENUM('running', 'passed', 'failed', 'needed_person', 'error');--> statement-breakpoint
CREATE TYPE "public"."eval_run_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."eval_run_trigger" AS ENUM('manual', 'push');--> statement-breakpoint
CREATE TYPE "public"."eval_suite_kind" AS ENUM('automatic', 'manual');--> statement-breakpoint
ALTER TYPE "public"."outbox_kind" ADD VALUE 'eval.start';--> statement-breakpoint
CREATE TABLE "eval_results" (
	"organization_id" text NOT NULL,
	"run_id" text NOT NULL,
	"case_id" text NOT NULL,
	"status" "eval_result_status" NOT NULL,
	"fields" jsonb,
	"answers" jsonb,
	"reason" text,
	"capture_key" text,
	"cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "eval_results_run_id_case_id_pk" PRIMARY KEY("run_id","case_id")
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"suite_id" text NOT NULL,
	"deployment_id" text NOT NULL,
	"model" text NOT NULL,
	"trigger" "eval_run_trigger" NOT NULL,
	"status" "eval_run_status" NOT NULL,
	"cases" integer DEFAULT 0 NOT NULL,
	"passed" integer DEFAULT 0 NOT NULL,
	"needed_person" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "eval_runs_org_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "eval_suite_cases" (
	"organization_id" text NOT NULL,
	"suite_id" text NOT NULL,
	"case_id" text NOT NULL,
	"input" jsonb NOT NULL,
	"expected" jsonb,
	"original" jsonb,
	"capture_key" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eval_suite_cases_suite_id_case_id_pk" PRIMARY KEY("suite_id","case_id")
);
--> statement-breakpoint
CREATE TABLE "eval_suites" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" "eval_suite_kind" NOT NULL,
	"cap" integer,
	"run_on_push" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eval_suites_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "eval_suites_cap" CHECK (("eval_suites"."kind" = 'automatic') = ("eval_suites"."cap" IS NOT NULL) AND ("eval_suites"."cap" IS NULL OR "eval_suites"."cap" BETWEEN 1 AND 1000))
);
--> statement-breakpoint
ALTER TABLE "eval_results" ADD CONSTRAINT "eval_results_organization_id_run_id_eval_runs_organization_id_id_fk" FOREIGN KEY ("organization_id","run_id") REFERENCES "public"."eval_runs"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_organization_id_suite_id_eval_suites_organization_id_id_fk" FOREIGN KEY ("organization_id","suite_id") REFERENCES "public"."eval_suites"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_organization_id_deployment_id_deployments_organization_id_id_fk" FOREIGN KEY ("organization_id","deployment_id") REFERENCES "public"."deployments"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_suite_cases" ADD CONSTRAINT "eval_suite_cases_organization_id_suite_id_eval_suites_organization_id_id_fk" FOREIGN KEY ("organization_id","suite_id") REFERENCES "public"."eval_suites"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_suite_cases" ADD CONSTRAINT "eval_suite_cases_organization_id_case_id_cases_organization_id_id_fk" FOREIGN KEY ("organization_id","case_id") REFERENCES "public"."cases"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_suites" ADD CONSTRAINT "eval_suites_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_suites" ADD CONSTRAINT "eval_suites_organization_id_agent_id_agents_organization_id_id_fk" FOREIGN KEY ("organization_id","agent_id") REFERENCES "public"."agents"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_runs_organization_id_suite_id_created_at_index" ON "eval_runs" USING btree ("organization_id","suite_id","created_at");--> statement-breakpoint
CREATE INDEX "eval_runs_organization_id_created_at_index" ON "eval_runs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "eval_suite_cases_organization_id_suite_id_added_at_index" ON "eval_suite_cases" USING btree ("organization_id","suite_id","added_at");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_suites_one_automatic" ON "eval_suites" USING btree ("organization_id","agent_id") WHERE kind = 'automatic';
--> statement-breakpoint

-- Tenant security for evals (see 0001_security.sql).
GRANT SELECT, INSERT, UPDATE, DELETE ON eval_suites TO preprocess_app, preprocess_system;
--> statement-breakpoint
ALTER TABLE eval_suites ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE eval_suites FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant ON eval_suites USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON eval_suite_cases TO preprocess_app, preprocess_system;
--> statement-breakpoint
ALTER TABLE eval_suite_cases ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE eval_suite_cases FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant ON eval_suite_cases USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON eval_runs TO preprocess_app, preprocess_system;
--> statement-breakpoint
ALTER TABLE eval_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE eval_runs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant ON eval_runs USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON eval_results TO preprocess_app, preprocess_system;
--> statement-breakpoint
ALTER TABLE eval_results ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE eval_results FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant ON eval_results USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
