CREATE TYPE "public"."access_method" AS ENUM('api', 'bulk_file', 'html_scrape', 'digital_pdf', 'ocr');--> statement-breakpoint
CREATE TYPE "public"."data_layer" AS ENUM('hs_nomenclature', 'duty_mfn', 'duty_preferential', 'trade_flow', 'tax', 'compliance');--> statement-breakpoint
CREATE TYPE "public"."ingestion_status" AS ENUM('running', 'succeeded', 'failed', 'partial');--> statement-breakpoint
CREATE TYPE "public"."jurisdiction_kind" AS ENUM('country', 'bloc', 'world');--> statement-breakpoint
CREATE TYPE "public"."reliability_tier" AS ENUM('authoritative_api', 'official_file', 'official_doc', 'aggregator');--> statement-breakpoint
CREATE TYPE "public"."volatility_class" AS ENUM('static', 'annual', 'scheduled', 'event_driven');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "country_tariff_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_code" varchar(8) NOT NULL,
	"year" integer NOT NULL,
	"simple_avg_mfn_all_pct" double precision,
	"trade_wtd_mfn_all_pct" double precision,
	"simple_avg_mfn_agr_pct" double precision,
	"trade_wtd_mfn_agr_pct" double precision,
	"simple_avg_mfn_non_agr_pct" double precision,
	"trade_wtd_mfn_non_agr_pct" double precision,
	"source_id" uuid,
	"ingestion_run_id" uuid,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stale_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "freshness_policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_code" varchar(8) NOT NULL,
	"layer" "data_layer" NOT NULL,
	"volatility_class" "volatility_class" NOT NULL,
	"refresh_interval_days" integer NOT NULL,
	"watch_enabled" boolean DEFAULT false NOT NULL,
	"last_refreshed_at" timestamp with time zone,
	"next_due_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hs_codes" (
	"code" varchar(6) NOT NULL,
	"hs_edition" varchar(8) DEFAULT 'HS2022' NOT NULL,
	"description" text NOT NULL,
	"level" integer NOT NULL,
	"parent_code" varchar(6),
	"section" varchar(4),
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "hs_codes_code_hs_edition_pk" PRIMARY KEY("code","hs_edition")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hs_mfn_duties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_code" varchar(8) NOT NULL,
	"hs_code" varchar(6) NOT NULL,
	"hs_edition" varchar(8) DEFAULT 'HS2022' NOT NULL,
	"year" integer,
	"simple_avg_pct" double precision,
	"max_rate_pct" double precision,
	"duty_free_pct" double precision,
	"nbr_tariff_lines" integer,
	"nbr_nav_lines" integer,
	"source_id" uuid,
	"ingestion_run_id" uuid,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stale_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hs_preferential_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_code" varchar(8) NOT NULL,
	"partner_code" varchar(8) NOT NULL,
	"hs_code" varchar(6) NOT NULL,
	"hs_edition" varchar(8) DEFAULT 'HS2022' NOT NULL,
	"year" integer,
	"simple_avg_pct" double precision,
	"coverage_status" varchar(32) DEFAULT 'unknown' NOT NULL,
	"source_id" uuid,
	"ingestion_run_id" uuid,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stale_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ingestion_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "ingestion_status" DEFAULT 'running' NOT NULL,
	"doc_hash" varchar(64),
	"version" integer DEFAULT 1 NOT NULL,
	"rows_upserted" integer DEFAULT 0 NOT NULL,
	"rows_flagged" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "jurisdictions" (
	"code" varchar(8) PRIMARY KEY NOT NULL,
	"kind" "jurisdiction_kind" NOT NULL,
	"name" varchar(128) NOT NULL,
	"iso_numeric" varchar(3),
	"api_codes" jsonb DEFAULT '{}'::jsonb,
	"is_customs_union" boolean DEFAULT false NOT NULL,
	"applies_vat" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(128) NOT NULL,
	"url" text NOT NULL,
	"watch_url" text,
	"jurisdiction_code" varchar(8) NOT NULL,
	"layer" "data_layer" NOT NULL,
	"access_method" "access_method" NOT NULL,
	"reliability_tier" "reliability_tier" NOT NULL,
	"volatility_class" "volatility_class" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trade_flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_code" varchar(8) NOT NULL,
	"partner_code" varchar(8) NOT NULL,
	"hs_code" varchar(6) NOT NULL,
	"hs_edition" varchar(8) DEFAULT 'HS2022' NOT NULL,
	"flow_code" varchar(2) NOT NULL,
	"year" integer NOT NULL,
	"trade_value_usd" bigint,
	"net_weight_kg" double precision,
	"qty" double precision,
	"qty_unit" varchar(32),
	"source_id" uuid,
	"ingestion_run_id" uuid,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stale_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "country_tariff_profiles" ADD CONSTRAINT "country_tariff_profiles_reporter_code_jurisdictions_code_fk" FOREIGN KEY ("reporter_code") REFERENCES "public"."jurisdictions"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "country_tariff_profiles" ADD CONSTRAINT "country_tariff_profiles_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "country_tariff_profiles" ADD CONSTRAINT "country_tariff_profiles_ingestion_run_id_ingestion_runs_id_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "freshness_policy" ADD CONSTRAINT "freshness_policy_jurisdiction_code_jurisdictions_code_fk" FOREIGN KEY ("jurisdiction_code") REFERENCES "public"."jurisdictions"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hs_mfn_duties" ADD CONSTRAINT "hs_mfn_duties_reporter_code_jurisdictions_code_fk" FOREIGN KEY ("reporter_code") REFERENCES "public"."jurisdictions"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hs_mfn_duties" ADD CONSTRAINT "hs_mfn_duties_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hs_mfn_duties" ADD CONSTRAINT "hs_mfn_duties_ingestion_run_id_ingestion_runs_id_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hs_preferential_rates" ADD CONSTRAINT "hs_preferential_rates_reporter_code_jurisdictions_code_fk" FOREIGN KEY ("reporter_code") REFERENCES "public"."jurisdictions"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hs_preferential_rates" ADD CONSTRAINT "hs_preferential_rates_partner_code_jurisdictions_code_fk" FOREIGN KEY ("partner_code") REFERENCES "public"."jurisdictions"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hs_preferential_rates" ADD CONSTRAINT "hs_preferential_rates_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hs_preferential_rates" ADD CONSTRAINT "hs_preferential_rates_ingestion_run_id_ingestion_runs_id_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sources" ADD CONSTRAINT "sources_jurisdiction_code_jurisdictions_code_fk" FOREIGN KEY ("jurisdiction_code") REFERENCES "public"."jurisdictions"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trade_flows" ADD CONSTRAINT "trade_flows_reporter_code_jurisdictions_code_fk" FOREIGN KEY ("reporter_code") REFERENCES "public"."jurisdictions"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trade_flows" ADD CONSTRAINT "trade_flows_partner_code_jurisdictions_code_fk" FOREIGN KEY ("partner_code") REFERENCES "public"."jurisdictions"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trade_flows" ADD CONSTRAINT "trade_flows_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trade_flows" ADD CONSTRAINT "trade_flows_ingestion_run_id_ingestion_runs_id_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "country_tariff_profiles_uq" ON "country_tariff_profiles" USING btree ("reporter_code","year");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "country_tariff_profiles_lookup_idx" ON "country_tariff_profiles" USING btree ("reporter_code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "freshness_policy_uq" ON "freshness_policy" USING btree ("jurisdiction_code","layer");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "freshness_policy_due_idx" ON "freshness_policy" USING btree ("next_due_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hs_codes_parent_idx" ON "hs_codes" USING btree ("parent_code","hs_edition");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hs_codes_level_idx" ON "hs_codes" USING btree ("level");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hs_mfn_duties_uq" ON "hs_mfn_duties" USING btree ("reporter_code","hs_code","hs_edition","year");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hs_mfn_duties_lookup_idx" ON "hs_mfn_duties" USING btree ("hs_code","reporter_code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hs_pref_rates_uq" ON "hs_preferential_rates" USING btree ("reporter_code","partner_code","hs_code","hs_edition","year");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hs_pref_rates_lookup_idx" ON "hs_preferential_rates" USING btree ("hs_code","reporter_code","partner_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingestion_runs_source_idx" ON "ingestion_runs" USING btree ("source_id","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jurisdictions_kind_idx" ON "jurisdictions" USING btree ("kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sources_coverage_idx" ON "sources" USING btree ("jurisdiction_code","layer");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "trade_flows_uq" ON "trade_flows" USING btree ("reporter_code","partner_code","hs_code","flow_code","year");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trade_flows_lookup_idx" ON "trade_flows" USING btree ("hs_code","reporter_code","partner_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trade_flows_flow_idx" ON "trade_flows" USING btree ("flow_code","year");