/**
 * Phase-1 database schema — Trade-for-All
 * ----------------------------------------
 * Implements .ai/PHASE_1_PLAN.md §3. Shared trade-reference data only:
 * NO tenant_id on any of these tables (they are identical for every user —
 * one copy, read-all-authenticated, write = service role / loader).
 * See .ai/specs/01-data-backbone.md and 00-foundation.md for the full model.
 */
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  doublePrecision,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/* ── enums ──────────────────────────────────────────────────────────── */
export const jurisdictionKind = pgEnum('jurisdiction_kind', ['country', 'bloc', 'world']);

export const dataLayer = pgEnum('data_layer', [
  'hs_nomenclature',   // the HS code tree (UN/WCO)
  'duty_mfn',
  'duty_preferential',
  'trade_flow',        // Comtrade
  'tax',               // Phase 2
  'compliance',        // Phase 2
]);

export const accessMethod = pgEnum('access_method', [
  'api', 'bulk_file', 'html_scrape', 'digital_pdf', 'ocr',
]);

export const reliabilityTier = pgEnum('reliability_tier', [
  'authoritative_api', 'official_file', 'official_doc', 'aggregator',
]);

export const volatilityClass = pgEnum('volatility_class', [
  'static', 'annual', 'scheduled', 'event_driven',
]);

export const ingestionStatus = pgEnum('ingestion_status', [
  'running', 'succeeded', 'failed', 'partial',
]);

export const dutyType = pgEnum('duty_type', ['bound', 'mfn_applied', 'preferential']);
export const rateType = pgEnum('rate_type', ['ad_valorem', 'specific', 'compound', 'free']);

/* ── jurisdictions: countries + blocs (+ WORLD sentinel) ────────────────
 * PK = code. NO tenant_id (shared reference).
 * iso_numeric = ISO 3166-1 numeric (stable). api_codes holds the
 * source-specific numeric codes (Comtrade/WTO differ from ISO) — filled
 * when each loader is wired.
 * ------------------------------------------------------------------------ */
export const jurisdictions = pgTable(
  'jurisdictions',
  {
    code: varchar('code', { length: 8 }).primaryKey(), // 'IN','US','GB','AU','AE' | 'EU','GCC' | 'WORLD'
    kind: jurisdictionKind('kind').notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    isoNumeric: varchar('iso_numeric', { length: 3 }),                 // ISO 3166-1 numeric, null for blocs
    apiCodes: jsonb('api_codes').$type<Record<string, string>>().default({}), // {comtrade:'699', wto:'356'}
    isCustomsUnion: boolean('is_customs_union').notNull().default(false),
    appliesVat: boolean('applies_vat').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ kindIdx: index('jurisdictions_kind_idx').on(t.kind) }),
);

/* ── sources: first-class source registry ─────────────────────────────── */
export const sources = pgTable(
  'sources',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 128 }).notNull(),
    url: text('url').notNull(),
    watchUrl: text('watch_url'),
    jurisdictionCode: varchar('jurisdiction_code', { length: 8 })
      .notNull().references(() => jurisdictions.code),
    layer: dataLayer('layer').notNull(),
    accessMethod: accessMethod('access_method').notNull(),
    reliabilityTier: reliabilityTier('reliability_tier').notNull(),
    volatilityClass: volatilityClass('volatility_class').notNull(),
    active: boolean('active').notNull().default(true),
    notes: text('notes'),
  },
  (t) => ({ coverageIdx: index('sources_coverage_idx').on(t.jurisdictionCode, t.layer) }),
);

/* ── ingestion_runs: every fetch, with change-detection hash ──────────── */
export const ingestionRuns = pgTable(
  'ingestion_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sourceId: uuid('source_id').notNull().references(() => sources.id),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    status: ingestionStatus('status').notNull().default('running'),
    docHash: varchar('doc_hash', { length: 64 }),
    version: integer('version').notNull().default(1),
    rowsUpserted: integer('rows_upserted').notNull().default(0),
    rowsFlagged: integer('rows_flagged').notNull().default(0),
    error: text('error'),
  },
  (t) => ({ sourceIdx: index('ingestion_runs_source_idx').on(t.sourceId, t.startedAt) }),
);

/* ── hs_codes: the HS nomenclature tree (classification engine) ─────────
 * PK = (code, hs_edition) — code alone is NOT unique across HS editions.
 * parent_code self-references within the same edition. NO tenant_id.
 * ------------------------------------------------------------------------ */
export const hsCodes = pgTable(
  'hs_codes',
  {
    code: varchar('code', { length: 6 }).notNull(),   // '96' | '9617' | '961700'
    hsEdition: varchar('hs_edition', { length: 8 }).notNull().default('HS2022'),
    description: text('description').notNull(),
    level: integer('level').notNull(),                // 2 | 4 | 6
    parentCode: varchar('parent_code', { length: 6 }),
    section: varchar('section', { length: 4 }),       // HS section I..XXI
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.code, t.hsEdition] }),
    parentIdx: index('hs_codes_parent_idx').on(t.parentCode, t.hsEdition),
    levelIdx: index('hs_codes_level_idx').on(t.level),
  }),
);

/* ── hs_tariffs: WTO facts, soft-versioned ──────────────────────────────
 * PK = surrogate id (history kept). The real uniqueness is a PARTIAL unique
 * index = exactly ONE current row per logical fact. Composite FK to
 * hs_codes(code, hs_edition). NO tenant_id (shared reference).
 * ------------------------------------------------------------------------ */
export const hsTariffs = pgTable(
  'hs_tariffs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    reporter: varchar('reporter', { length: 8 }).notNull()
      .references(() => jurisdictions.code),                 // importer / destination
    partner: varchar('partner', { length: 8 }).notNull()
      .default('WORLD').references(() => jurisdictions.code), // origin; WORLD = MFN baseline
    hs6: varchar('hs6', { length: 6 }).notNull(),
    hsEdition: varchar('hs_edition', { length: 8 }).notNull().default('HS2022'),
    year: integer('year').notNull(),

    dutyType: dutyType('duty_type').notNull(),
    rateType: rateType('rate_type').notNull(),
    adValoremPct: doublePrecision('ad_valorem_pct'),
    avePct: doublePrecision('ave_pct'),
    dutyExpression: text('duty_expression'),

    // HS6 aggregation across national lines (WTO is HS6-level)
    simpleAvgPct: doublePrecision('simple_avg_pct'),
    minRatePct: doublePrecision('min_rate_pct'),
    maxRatePct: doublePrecision('max_rate_pct'),
    nbrLines: integer('nbr_lines'),
    tradeValueUsd: doublePrecision('trade_value_usd'),

    // provenance + freshness
    sourceId: uuid('source_id').references(() => sources.id),
    sourceUrl: text('source_url'),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    confidence: doublePrecision('confidence').notNull().default(1),
    supersededBy: uuid('superseded_by'),
  },
  (t) => ({
    hsFk: foreignKey({
      columns: [t.hs6, t.hsEdition],
      foreignColumns: [hsCodes.code, hsCodes.hsEdition],
      name: 'hs_tariffs_hs_fk',
    }),
    currentUq: uniqueIndex('hs_tariffs_current_uq')
      .on(t.reporter, t.partner, t.hs6, t.year, t.dutyType, t.hsEdition)
      .where(sql`${t.supersededBy} IS NULL`),
    lookupIdx: index('hs_tariffs_lookup_idx')
      .on(t.hs6, t.reporter, t.dutyType)
      .where(sql`${t.supersededBy} IS NULL`),
  }),
);
