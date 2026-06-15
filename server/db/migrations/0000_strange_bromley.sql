CREATE TYPE "public"."access_method" AS ENUM('api', 'bulk_file', 'html_scrape', 'digital_pdf', 'ocr');--> statement-breakpoint
CREATE TYPE "public"."data_layer" AS ENUM('hs_nomenclature', 'duty_mfn', 'duty_preferential', 'trade_flow', 'tax', 'compliance');--> statement-breakpoint
CREATE TYPE "public"."duty_type" AS ENUM('bound', 'mfn_applied', 'preferential');--> statement-breakpoint
CREATE TYPE "public"."ingestion_status" AS ENUM('running', 'succeeded', 'failed', 'partial');--> statement-breakpoint
CREATE TYPE "public"."jurisdiction_kind" AS ENUM('country', 'bloc', 'world');--> statement-breakpoint
CREATE TYPE "public"."rate_type" AS ENUM('ad_valorem', 'specific', 'compound', 'free');--> statement-breakpoint
CREATE TYPE "public"."reliability_tier" AS ENUM('authoritative_api', 'official_file', 'official_doc', 'aggregator');--> statement-breakpoint
CREATE TYPE "public"."volatility_class" AS ENUM('static', 'annual', 'scheduled', 'event_driven');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hs_codes" (
	"code" varchar(6) NOT NULL,
	"hs_edition" varchar(8) DEFAULT 'HS2022' NOT NULL,
	"description" text NOT NULL,
	"level" integer NOT NULL,
	"parent_code" varchar(6),
	"section" varchar(4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hs_codes_code_hs_edition_pk" PRIMARY KEY("code","hs_edition")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hs_tariffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter" varchar(8) NOT NULL,
	"partner" varchar(8) DEFAULT 'WORLD' NOT NULL,
	"hs6" varchar(6) NOT NULL,
	"hs_edition" varchar(8) DEFAULT 'HS2022' NOT NULL,
	"year" integer NOT NULL,
	"duty_type" "duty_type" NOT NULL,
	"rate_type" "rate_type" NOT NULL,
	"ad_valorem_pct" double precision,
	"ave_pct" double precision,
	"duty_expression" text,
	"simple_avg_pct" double precision,
	"min_rate_pct" double precision,
	"max_rate_pct" double precision,
	"nbr_lines" integer,
	"trade_value_usd" double precision,
	"source_id" uuid,
	"source_url" text,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confidence" double precision DEFAULT 1 NOT NULL,
	"superseded_by" uuid
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
DO $$ BEGIN
 ALTER TABLE "hs_tariffs" ADD CONSTRAINT "hs_tariffs_reporter_jurisdictions_code_fk" FOREIGN KEY ("reporter") REFERENCES "public"."jurisdictions"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hs_tariffs" ADD CONSTRAINT "hs_tariffs_partner_jurisdictions_code_fk" FOREIGN KEY ("partner") REFERENCES "public"."jurisdictions"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hs_tariffs" ADD CONSTRAINT "hs_tariffs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hs_tariffs" ADD CONSTRAINT "hs_tariffs_hs_fk" FOREIGN KEY ("hs6","hs_edition") REFERENCES "public"."hs_codes"("code","hs_edition") ON DELETE no action ON UPDATE no action;
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
CREATE INDEX IF NOT EXISTS "hs_codes_parent_idx" ON "hs_codes" USING btree ("parent_code","hs_edition");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hs_codes_level_idx" ON "hs_codes" USING btree ("level");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hs_tariffs_current_uq" ON "hs_tariffs" USING btree ("reporter","partner","hs6","year","duty_type","hs_edition") WHERE "hs_tariffs"."superseded_by" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hs_tariffs_lookup_idx" ON "hs_tariffs" USING btree ("hs6","reporter","duty_type") WHERE "hs_tariffs"."superseded_by" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingestion_runs_source_idx" ON "ingestion_runs" USING btree ("source_id","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jurisdictions_kind_idx" ON "jurisdictions" USING btree ("kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sources_coverage_idx" ON "sources" USING btree ("jurisdiction_code","layer");