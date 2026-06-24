/**
 * Phase-1 database schema — Trade-for-All
 * ----------------------------------------
 * Shared trade-reference data only — NO tenant_id on any table.
 * One copy, read-all-authenticated, write = service role / loader.
 * See .ai/specs/01-data-backbone.md for the full model and ADRs.
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
  bigint,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/* ── enums ──────────────────────────────────────────────────────────── */
export const jurisdictionKind = pgEnum('jurisdiction_kind', ['country', 'bloc', 'world']);

export const dataLayer = pgEnum('data_layer', [
  'hs_nomenclature',
  'duty_mfn',
  'duty_preferential',
  'trade_flow',
  'tax',
  'compliance',
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

export const logLevel = pgEnum('log_level', ['debug', 'info', 'warn', 'error']);

/* ── jurisdictions ───────────────────────────────────────────────────
 * Countries, blocs (EU, GCC), and the WORLD sentinel.
 * api_codes holds source-specific reporter codes:
 *   { "wto": "840", "comtrade": "842" }  ← USA example (they differ!)
 * -------------------------------------------------------------------- */
export const jurisdictions = pgTable(
  'jurisdictions',
  {
    code: varchar('code', { length: 8 }).primaryKey(),
    kind: jurisdictionKind('kind').notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    isoNumeric: varchar('iso_numeric', { length: 3 }),
    apiCodes: jsonb('api_codes').$type<Record<string, string>>().default({}),
    isCustomsUnion: boolean('is_customs_union').notNull().default(false),
    appliesVat: boolean('applies_vat').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ kindIdx: index('jurisdictions_kind_idx').on(t.kind) }),
);

/* ── sources: first-class source registry ────────────────────────────
 * One row per (jurisdiction × data-layer × access-method).
 * Every stored fact references a source_id.
 * -------------------------------------------------------------------- */
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

/* ── ingestion_runs: every fetch, with SHA-256 change detection ────── */
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

/* ── freshness_policy: per (jurisdiction, layer) renewal schedule ─────
 * pg-boss cron reads next_due_at to schedule ingestion jobs.
 * Volatility class drives the cadence:
 *   static       → rebuild only on HS edition change (years)
 *   annual       → once per year (HS codes, MFN duties)
 *   scheduled    → FTA phase-in dates (pre-computed)
 *   event_driven → compliance/NTM — on-demand + ePing trigger
 * -------------------------------------------------------------------- */
export const freshnessPolicy = pgTable(
  'freshness_policy',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    jurisdictionCode: varchar('jurisdiction_code', { length: 8 })
      .notNull().references(() => jurisdictions.code),
    layer: dataLayer('layer').notNull(),
    volatilityClass: volatilityClass('volatility_class').notNull(),
    refreshIntervalDays: integer('refresh_interval_days').notNull(),
    watchEnabled: boolean('watch_enabled').notNull().default(false),
    lastRefreshedAt: timestamp('last_refreshed_at', { withTimezone: true }),
    nextDueAt: timestamp('next_due_at', { withTimezone: true }),
  },
  (t) => ({
    uq: uniqueIndex('freshness_policy_uq').on(t.jurisdictionCode, t.layer),
    dueIdx: index('freshness_policy_due_idx').on(t.nextDueAt),
  }),
);

/* ── hs_codes: international HS nomenclature tree ────────────────────
 * PK = (code, hs_edition) — same numeric code can appear in HS2017
 * and HS2022 with different descriptions or parent assignments.
 * Populated from Comtrade H6.json (one bulk call → ~6,940 rows).
 * -------------------------------------------------------------------- */
export const hsCodes = pgTable(
  'hs_codes',
  {
    code: varchar('code', { length: 6 }).notNull(),
    hsEdition: varchar('hs_edition', { length: 8 }).notNull().default('HS2022'),
    description: text('description').notNull(),
    level: integer('level').notNull(),        // 2 = chapter, 4 = heading, 6 = subheading
    parentCode: varchar('parent_code', { length: 6 }),
    section: varchar('section', { length: 4 }),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.code, t.hsEdition] }),
    parentIdx: index('hs_codes_parent_idx').on(t.parentCode, t.hsEdition),
    levelIdx: index('hs_codes_level_idx').on(t.level),
  }),
);

/* ── hs_mfn_duties: WTO MFN tariff facts per HS code per reporter ─────
 * Maps to WTO Timeseries indicators (one row per hs_code × reporter × year):
 *   simple_avg_pct    ← HS_A_0010  simple average ad valorem MFN %
 *   max_rate_pct      ← HS_A_0020  maximum ad valorem duty %
 *   duty_free_pct     ← HS_A_0030  % of tariff lines that are duty-free
 *   nbr_tariff_lines  ← HS_A_0040  number of national tariff lines
 *   nbr_nav_lines     ← HS_A_0050  number of non-ad-valorem (NAV) lines
 *
 * reporter_code → jurisdictions.code (e.g. 'US', 'GB', 'EU', 'AU', 'AE')
 * WTO reporter codes live in jurisdictions.api_codes['wto'] (ISO-3166 numeric).
 * -------------------------------------------------------------------- */
export const hsMfnDuties = pgTable(
  'hs_mfn_duties',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    reporterCode: varchar('reporter_code', { length: 8 })
      .notNull().references(() => jurisdictions.code),
    hsCode: varchar('hs_code', { length: 6 }).notNull(),
    hsEdition: varchar('hs_edition', { length: 8 }).notNull().default('HS2022'),
    year: integer('year'),                          // null for bound rates (no time dimension in WTO)

    simpleAvgPct: doublePrecision('simple_avg_pct'),   // HS_A_0010
    maxRatePct: doublePrecision('max_rate_pct'),        // HS_A_0020
    dutyFreePct: doublePrecision('duty_free_pct'),      // HS_A_0030
    nbrTariffLines: integer('nbr_tariff_lines'),        // HS_A_0040
    nbrNavLines: integer('nbr_nav_lines'),              // HS_A_0050

    // ── SCD Type-2 history (ADR-023): never overwrite, version on change ──
    version: integer('version').notNull().default(1),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull().defaultNow(),
    validTo: timestamp('valid_to', { withTimezone: true }),          // null = still current
    isCurrent: boolean('is_current').notNull().default(true),
    rowHash: varchar('row_hash', { length: 64 }),                    // sha-256 of value fields
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }).notNull().defaultNow(),

    sourceId: uuid('source_id').references(() => sources.id),
    ingestionRunId: uuid('ingestion_run_id').references(() => ingestionRuns.id),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    staleAt: timestamp('stale_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => ({
    // Exactly ONE current row per natural key; unlimited historical versions.
    currentUq: uniqueIndex('hs_mfn_duties_current_uq')
      .on(t.reporterCode, t.hsCode, t.hsEdition, sql`coalesce(${t.year}, 0)`)
      .where(sql`is_current`),
    lookupIdx: index('hs_mfn_duties_lookup_idx').on(t.hsCode, t.reporterCode),
    historyIdx: index('hs_mfn_duties_history_idx')
      .on(t.reporterCode, t.hsCode, t.hsEdition, t.year, t.version),
  }),
);

/* ── hs_preferential_rates: WTO lowest preferential rate per corridor ─
 * Maps to WTO indicator HS_P_0070 (lowest preferential simple avg %).
 * Only rows where an FTA exists are stored — absence = no FTA, pay MFN.
 *
 * reporter_code = importer destination (FK → jurisdictions.code).
 * partner_code  = exporter origin — WTO numeric code (e.g. '356' India,
 *   '156' China). NO FK: covers all ~170 WTO members, not just our 8.
 * Fetched with p=all so one call per chapter returns all partner FTAs.
 * -------------------------------------------------------------------- */
export const hsPreferentialRates = pgTable(
  'hs_preferential_rates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    reporterCode: varchar('reporter_code', { length: 8 })
      .notNull().references(() => jurisdictions.code),
    partnerCode: varchar('partner_code', { length: 8 })
      .notNull(),  // WTO numeric code — no FK, covers all ~170 WTO members
    hsCode: varchar('hs_code', { length: 6 }).notNull(),
    hsEdition: varchar('hs_edition', { length: 8 }).notNull().default('HS2022'),
    year: integer('year'),

    simpleAvgPct: doublePrecision('simple_avg_pct'),    // HS_P_0070 — null if no FTA
    coverageStatus: varchar('coverage_status', { length: 32 })
      .notNull().default('unknown'),                     // 'available' | 'no_fta' | 'pending'

    // ── SCD Type-2 history (ADR-023): never overwrite, version on change ──
    version: integer('version').notNull().default(1),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull().defaultNow(),
    validTo: timestamp('valid_to', { withTimezone: true }),          // null = still current
    isCurrent: boolean('is_current').notNull().default(true),
    rowHash: varchar('row_hash', { length: 64 }),                    // sha-256 of value fields
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }).notNull().defaultNow(),

    sourceId: uuid('source_id').references(() => sources.id),
    ingestionRunId: uuid('ingestion_run_id').references(() => ingestionRuns.id),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    staleAt: timestamp('stale_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => ({
    // Exactly ONE current row per natural key; unlimited historical versions.
    currentUq: uniqueIndex('hs_pref_rates_current_uq')
      .on(t.reporterCode, t.partnerCode, t.hsCode, t.hsEdition, sql`coalesce(${t.year}, 0)`)
      .where(sql`is_current`),
    lookupIdx: index('hs_pref_rates_lookup_idx').on(t.hsCode, t.reporterCode, t.partnerCode),
    historyIdx: index('hs_pref_rates_history_idx')
      .on(t.reporterCode, t.partnerCode, t.hsCode, t.hsEdition, t.year, t.version),
  }),
);


/* ── trade_flows: UN Comtrade import/export volumes ──────────────────
 * One row per (reporter × partner × hs_code × flow × year).
 * Answers: "How much coffee does USA import from India per year?"
 *
 * reporter_code = the country reporting the trade stat
 * partner_code  = the counterpart ('IN', 'WORLD' for totals)
 * flow_code     = 'M' (import) | 'X' (export)
 * Comtrade reporter codes live in jurisdictions.api_codes['comtrade'] (M49).
 * -------------------------------------------------------------------- */
export const tradeFlows = pgTable(
  'trade_flows',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    reporterCode: varchar('reporter_code', { length: 8 })
      .notNull().references(() => jurisdictions.code),
    partnerCode: varchar('partner_code', { length: 8 })
      .notNull().references(() => jurisdictions.code),
    hsCode: varchar('hs_code', { length: 6 }).notNull(),
    hsEdition: varchar('hs_edition', { length: 8 }).notNull().default('HS2022'),
    flowCode: varchar('flow_code', { length: 2 }).notNull(),  // 'M' or 'X'
    year: integer('year').notNull(),

    tradeValueUsd: bigint('trade_value_usd', { mode: 'number' }),
    netWeightKg: doublePrecision('net_weight_kg'),
    qty: doublePrecision('qty'),
    qtyUnit: varchar('qty_unit', { length: 32 }),

    sourceId: uuid('source_id').references(() => sources.id),
    ingestionRunId: uuid('ingestion_run_id').references(() => ingestionRuns.id),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    staleAt: timestamp('stale_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => ({
    uq: uniqueIndex('trade_flows_uq').on(
      t.reporterCode, t.partnerCode, t.hsCode, t.flowCode, t.year,
    ),
    lookupIdx: index('trade_flows_lookup_idx').on(t.hsCode, t.reporterCode, t.partnerCode),
    flowIdx: index('trade_flows_flow_idx').on(t.flowCode, t.year),
  }),
);

/* ── pipeline_logs: LLM-queryable log store for all loaders ──────────
 * Every API call and upsert emits a row here in addition to stdout.
 * Design goal: an LLM can diagnose any pipeline failure using only SQL
 * against this table + ingestion_runs. No human log-reading required.
 *
 * Retention: rows older than 90 days are deleted by a scheduled job.
 * See .ai/specs/03-observability.md for the full diagnostic query set.
 * -------------------------------------------------------------------- */
export const pipelineLogs = pgTable(
  'pipeline_logs',
  {
    id:             uuid('id').defaultRandom().primaryKey(),
    ingestionRunId: uuid('ingestion_run_id').references(() => ingestionRuns.id),
    loaderName:     varchar('loader_name', { length: 64 }).notNull(),
    level:          logLevel('level').notNull(),
    message:        text('message').notNull(),
    phase:          varchar('phase', { length: 64 }),           // 'fetch'|'transform'|'upsert'|'retry'
    tableAffected:  varchar('table_affected', { length: 64 }),

    // API call context
    apiName:        varchar('api_name', { length: 32 }),        // 'wto'|'comtrade'
    apiUrl:         text('api_url'),                            // sanitised — no API key
    httpStatus:     integer('http_status'),
    durationMs:     integer('duration_ms'),
    attemptNumber:  integer('attempt_number'),

    // Data context — what row is being processed
    reporterCode:   varchar('reporter_code', { length: 8 }),
    partnerCode:    varchar('partner_code', { length: 8 }),
    hsCode:         varchar('hs_code', { length: 6 }),
    indicator:      varchar('indicator', { length: 16 }),
    year:           integer('year'),

    // Result
    rowsAffected:   integer('rows_affected'),
    errorCode:      varchar('error_code', { length: 32 }),      // 'rate_limited'|'no_coverage'|'timeout'
    errorDetail:    text('error_detail'),
    meta:           jsonb('meta').$type<Record<string, unknown>>(),

    createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    runIdx:    index('pipeline_logs_run_idx').on(t.ingestionRunId, t.createdAt),
    levelIdx:  index('pipeline_logs_level_idx').on(t.level, t.createdAt),
    loaderIdx: index('pipeline_logs_loader_idx').on(t.loaderName, t.createdAt),
    apiIdx:    index('pipeline_logs_api_idx').on(t.apiName, t.httpStatus),
    hsIdx:     index('pipeline_logs_hs_idx').on(t.hsCode, t.reporterCode),
    errorIdx:  index('pipeline_logs_error_idx')
      .on(t.errorCode)
      .where(sql`error_code IS NOT NULL`),
  }),
);
