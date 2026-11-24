CREATE TYPE "public"."outbox_kind" AS ENUM('case.start', 'webhook', 'email');--> statement-breakpoint
CREATE TABLE "case_mentions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"case_id" text NOT NULL,
	"group_id" text NOT NULL,
	"message_id" text NOT NULL,
	"by" text NOT NULL,
	"message" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"case_id" text,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" bigint NOT NULL,
	"sha256" "bytea" NOT NULL,
	"r2_key" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_org_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"organization_id" text NOT NULL,
	"operation" text NOT NULL,
	"key" text NOT NULL,
	"fingerprint" "bytea" NOT NULL,
	"case_id" text,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_organization_id_operation_key_pk" PRIMARY KEY("organization_id","operation","key"),
	CONSTRAINT "idempotency_keys_key_length" CHECK (char_length("idempotency_keys"."key") between 1 and 255)
);
--> statement-breakpoint
CREATE TABLE "inbox_reads" (
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"item_key" text NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_reads_organization_id_user_id_item_key_pk" PRIMARY KEY("organization_id","user_id","item_key")
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" "outbox_kind" NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"drained_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "review_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"case_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"path" text,
	"before" jsonb,
	"after" jsonb,
	"checks" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"endpoint_id" text NOT NULL,
	"event_type" text NOT NULL,
	"case_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_status_code" integer,
	"last_error" text,
	"next_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"url" text NOT NULL,
	"events" text[] NOT NULL,
	"agent_ids" text[],
	"key_version" integer NOT NULL,
	"signing_secret" "bytea" NOT NULL,
	"previous_signing_secret" "bytea",
	"previous_key_version" integer,
	"previous_expires_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"disabled_reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_endpoints_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "webhook_endpoints_https" CHECK ("webhook_endpoints"."url" like 'https://%')
);
--> statement-breakpoint
ALTER TABLE "case_mentions" ADD CONSTRAINT "case_mentions_organization_id_case_id_cases_organization_id_id_fk" FOREIGN KEY ("organization_id","case_id") REFERENCES "public"."cases"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_mentions" ADD CONSTRAINT "case_mentions_organization_id_group_id_groups_organization_id_id_fk" FOREIGN KEY ("organization_id","group_id") REFERENCES "public"."groups"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_organization_id_case_id_cases_organization_id_id_fk" FOREIGN KEY ("organization_id","case_id") REFERENCES "public"."cases"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_reads" ADD CONSTRAINT "inbox_reads_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_reads" ADD CONSTRAINT "inbox_reads_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_organization_id_case_id_cases_organization_id_id_fk" FOREIGN KEY ("organization_id","case_id") REFERENCES "public"."cases"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_organization_id_endpoint_id_webhook_endpoints_organization_id_id_fk" FOREIGN KEY ("organization_id","endpoint_id") REFERENCES "public"."webhook_endpoints"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_organization_id_case_id_cases_organization_id_id_fk" FOREIGN KEY ("organization_id","case_id") REFERENCES "public"."cases"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_mentions_organization_id_group_id_at_index" ON "case_mentions" USING btree ("organization_id","group_id","at");--> statement-breakpoint
CREATE INDEX "files_organization_id_case_id_index" ON "files" USING btree ("organization_id","case_id");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_at_index" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "outbox_undrained" ON "outbox" USING btree ("created_at") WHERE drained_at is null;--> statement-breakpoint
CREATE INDEX "review_events_organization_id_case_id_at_index" ON "review_events" USING btree ("organization_id","case_id","at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_organization_id_endpoint_id_created_at_index" ON "webhook_deliveries" USING btree ("organization_id","endpoint_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_due" ON "webhook_deliveries" USING btree ("next_attempt_at") WHERE status = 'pending';