CREATE TABLE "integration_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"device" text NOT NULL,
	"link" text,
	"email" text,
	"message" text,
	"locale" text,
	"user_id" uuid,
	"ip_hash" text,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_requests" ADD CONSTRAINT "integration_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_requests_created_idx" ON "integration_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "integration_requests_ip_idx" ON "integration_requests" USING btree ("ip_hash","created_at");