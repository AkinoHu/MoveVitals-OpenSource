CREATE TABLE "email_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_locks" (
	"key" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backups" ALTER COLUMN "bytes" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "manual_split" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD COLUMN "include_profile" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD COLUMN "include_labs" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD COLUMN "include_names" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD COLUMN "nonce_hash" text;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "email_tokens" ADD CONSTRAINT "email_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_tokens_user_idx" ON "email_tokens" USING btree ("user_id");--> statement-breakpoint
-- Null out dangling references first so the new foreign keys can be added to existing data.
UPDATE "activities" SET "group_id" = NULL WHERE "group_id" IS NOT NULL AND "group_id" NOT IN (SELECT "id" FROM "activity_groups");--> statement-breakpoint
UPDATE "activity_groups" SET "primary_activity_id" = NULL WHERE "primary_activity_id" IS NOT NULL AND "primary_activity_id" NOT IN (SELECT "id" FROM "activities");--> statement-breakpoint
UPDATE "activity_groups" SET "manual_primary_activity_id" = NULL WHERE "manual_primary_activity_id" IS NOT NULL AND "manual_primary_activity_id" NOT IN (SELECT "id" FROM "activities");--> statement-breakpoint
-- Pending OAuth round trips cannot be bound to a browser; they are short-lived, so drop them.
DELETE FROM "oauth_states";--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_group_id_activity_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."activity_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_groups" ADD CONSTRAINT "activity_groups_primary_activity_id_activities_id_fk" FOREIGN KEY ("primary_activity_id") REFERENCES "public"."activities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_groups" ADD CONSTRAINT "activity_groups_manual_primary_activity_id_activities_id_fk" FOREIGN KEY ("manual_primary_activity_id") REFERENCES "public"."activities"("id") ON DELETE set null ON UPDATE no action;