CREATE TABLE "oauth_clients" (
	"provider" text NOT NULL,
	"issuer" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_clients_provider_issuer_redirect_uri_pk" PRIMARY KEY("provider","issuer","redirect_uri")
);
--> statement-breakpoint
ALTER TABLE "oauth_states" ADD COLUMN "extra" jsonb;