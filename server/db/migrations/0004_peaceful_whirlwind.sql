DROP INDEX IF EXISTS "hs_mfn_duties_uq";--> statement-breakpoint
DROP INDEX IF EXISTS "hs_pref_rates_uq";--> statement-breakpoint
ALTER TABLE "hs_mfn_duties" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "hs_mfn_duties" ADD COLUMN "valid_from" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "hs_mfn_duties" ADD COLUMN "valid_to" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hs_mfn_duties" ADD COLUMN "is_current" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "hs_mfn_duties" ADD COLUMN "row_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "hs_mfn_duties" ADD COLUMN "last_verified_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "hs_preferential_rates" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "hs_preferential_rates" ADD COLUMN "valid_from" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "hs_preferential_rates" ADD COLUMN "valid_to" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hs_preferential_rates" ADD COLUMN "is_current" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "hs_preferential_rates" ADD COLUMN "row_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "hs_preferential_rates" ADD COLUMN "last_verified_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hs_mfn_duties_current_uq" ON "hs_mfn_duties" USING btree ("reporter_code","hs_code","hs_edition",coalesce("year", 0)) WHERE is_current;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hs_mfn_duties_history_idx" ON "hs_mfn_duties" USING btree ("reporter_code","hs_code","hs_edition","year","version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hs_pref_rates_current_uq" ON "hs_preferential_rates" USING btree ("reporter_code","partner_code","hs_code","hs_edition",coalesce("year", 0)) WHERE is_current;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hs_pref_rates_history_idx" ON "hs_preferential_rates" USING btree ("reporter_code","partner_code","hs_code","hs_edition","year","version");