CREATE TABLE "notice_dismissals" (
	"user_id" text NOT NULL,
	"notice_id" text NOT NULL,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notice_dismissals_user_id_notice_id_pk" PRIMARY KEY("user_id","notice_id")
);
--> statement-breakpoint
ALTER TABLE "notice_dismissals" ADD CONSTRAINT "notice_dismissals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Not tenant-scoped: per person, so only the system role reads and writes it,
-- always for the signed-in user (see 0001_security.sql).
GRANT SELECT, INSERT ON notice_dismissals TO preprocess_system;
