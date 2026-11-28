CREATE TABLE "home_dismissals" (
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"card" text NOT NULL,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "home_dismissals_organization_id_user_id_card_pk" PRIMARY KEY("organization_id","user_id","card")
);
--> statement-breakpoint
ALTER TABLE "home_dismissals" ADD CONSTRAINT "home_dismissals_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home_dismissals" ADD CONSTRAINT "home_dismissals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Tenant security for home dismissals (see 0001_security.sql). Every row
-- belongs to one organization, which alone can read it.
GRANT SELECT, INSERT, UPDATE, DELETE ON home_dismissals TO preprocess_app, preprocess_system;--> statement-breakpoint
ALTER TABLE home_dismissals ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE home_dismissals FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant ON home_dismissals USING (organization_id = current_setting('app.org_id', true)) WITH CHECK (organization_id = current_setting('app.org_id', true));
