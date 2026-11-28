-- contract: the support center was cancelled (PRE-155). preprocess#251 (a66e4e7, in production since run 46114972335) removed every reader and writer of these tables, and no request was ever made.
DROP TABLE "support_attachments" CASCADE;--> statement-breakpoint
DROP TABLE "support_messages" CASCADE;--> statement-breakpoint
DROP TABLE "support_requests" CASCADE;
