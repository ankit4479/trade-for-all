CREATE TYPE "public"."log_level" AS ENUM('debug', 'info', 'warn', 'error');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pipeline_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ingestion_run_id" uuid,
	"loader_name" varchar(64) NOT NULL,
	"level" "log_level" NOT NULL,
	"message" text NOT NULL,
	"phase" varchar(64),
	"table_affected" varchar(64),
	"api_name" varchar(32),
	"api_url" text,
	"http_status" integer,
	"duration_ms" integer,
	"attempt_number" integer,
	"reporter_code" varchar(8),
	"partner_code" varchar(8),
	"hs_code" varchar(6),
	"indicator" varchar(16),
	"year" integer,
	"rows_affected" integer,
	"error_code" varchar(32),
	"error_detail" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pipeline_logs" ADD CONSTRAINT "pipeline_logs_ingestion_run_id_ingestion_runs_id_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pipeline_logs_run_idx" ON "pipeline_logs" USING btree ("ingestion_run_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pipeline_logs_level_idx" ON "pipeline_logs" USING btree ("level","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pipeline_logs_loader_idx" ON "pipeline_logs" USING btree ("loader_name","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pipeline_logs_api_idx" ON "pipeline_logs" USING btree ("api_name","http_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pipeline_logs_hs_idx" ON "pipeline_logs" USING btree ("hs_code","reporter_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pipeline_logs_error_idx" ON "pipeline_logs" USING btree ("error_code") WHERE error_code IS NOT NULL;