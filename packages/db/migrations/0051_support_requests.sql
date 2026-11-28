CREATE TABLE "support_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text,
	"message_id" text,
	"organization_id" text,
	"uploaded_by" text,
	"r2_key" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_attachments_size" CHECK ("support_attachments"."size_bytes" between 0 and 26214400)
);
--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"organization_id" text,
	"author_kind" text NOT NULL,
	"author_user_id" text,
	"body" text NOT NULL,
	"via" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"requester_user_id" text,
	"requester_email" text NOT NULL,
	"subject" text NOT NULL,
	"category" text NOT NULL,
	"severity" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"channel" text NOT NULL,
	"plan_at_submit" text,
	"agent_id" text,
	"case_ref" text,
	"incident_ref" text,
	"support_case_id" text,
	"reply_token" text NOT NULL,
	"first_response_due_at" timestamp with time zone,
	"first_response_at" timestamp with time zone,
	"first_response_solved" boolean DEFAULT false NOT NULL,
	"sla_warned_at" timestamp with time zone,
	"sla_breached_at" timestamp with time zone,
	"solved_at" timestamp with time zone,
	"requester_notice_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_requests_replyToken_unique" UNIQUE("reply_token"),
	CONSTRAINT "support_requests_severity" CHECK ("support_requests"."severity" between 1 and 3),
	CONSTRAINT "support_requests_signed_out" CHECK ("support_requests"."organization_id" is not null or "support_requests"."channel" in ('form', 'email'))
);
--> statement-breakpoint
ALTER TABLE "support_attachments" ADD CONSTRAINT "support_attachments_request_id_support_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."support_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_attachments" ADD CONSTRAINT "support_attachments_message_id_support_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."support_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_attachments" ADD CONSTRAINT "support_attachments_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_request_id_support_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."support_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_requester_user_id_user_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_attachments_request_id_index" ON "support_attachments" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "support_attachments_created_at_index" ON "support_attachments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "support_messages_request_id_created_at_index" ON "support_messages" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "support_requests_organization_id_created_at_index" ON "support_requests" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "support_requests_requester_user_id_index" ON "support_requests" USING btree ("requester_user_id");--> statement-breakpoint
CREATE INDEX "support_requests_status_solved_at_index" ON "support_requests" USING btree ("status","solved_at");--> statement-breakpoint
-- Tenant security for the support tables (see 0001_security.sql). A request
-- with no organization (a signed-out visitor, an unmatched email) is visible
-- to DB_SYSTEM only: the tenant policy never matches a null organization.
-- Retention and inbound email run as the system role.
GRANT SELECT, INSERT, UPDATE, DELETE ON support_requests, support_messages, support_attachments TO preprocess_app, preprocess_system;--> statement-breakpoint
ALTER TABLE support_requests ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE support_requests FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant ON support_requests USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE support_messages FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant ON support_messages USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE support_attachments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE support_attachments FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant ON support_attachments USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
