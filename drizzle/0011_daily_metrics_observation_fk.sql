-- Observations can be deleted (disconnect with data removal, Strava deauth), so
-- clear dangling pointers before the constraint is added.
UPDATE "daily_metrics" SET "selected_observation_id" = NULL WHERE "selected_observation_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "observations" o WHERE o."id" = "daily_metrics"."selected_observation_id");--> statement-breakpoint
ALTER TABLE "daily_metrics" ADD CONSTRAINT "daily_metrics_selected_observation_id_observations_id_fk" FOREIGN KEY ("selected_observation_id") REFERENCES "public"."observations"("id") ON DELETE set null ON UPDATE no action;