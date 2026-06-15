# 01 — Data Backbone Tech Spec (the canonical trade-data engine)

> **Personas:** `data-engineer` (lead), `trade-customs-expert` (domain accuracy authority),
> `architect` (Fowler — reversible, one datastore). `ai-rag-engineer` for the extraction tier.
> **Status:** v1 (2026-06-09).
> **Scope:** How we build *our own* trade-data store by ingesting authoritative sources, keyed by HS code
> and resolved per target country, for **5 corridors: India → US, EU, UK, UAE, AUS**. Covers the
> jurisdiction model, the two-layer HS model, the source registry, the tiered ingestion + validation
> pipeline, the data-renewal/freshness policy, and the lookup resolver.
> **Relationship to other specs:** This is the *substrate* `phase-1-data-rag-accuracy.md` sits on. It
> **extends `00-foundation.md`** — it does NOT re-decide anything locked there. New decisions are recorded
> as **ADR-015 … ADR-021** (foundation owns ADR-001…014). Schema here is *additive/amending* to
> foundation §2; every amendment is flagged.
>
> This document is buildable: the Drizzle in §2 is real TypeScript that `drizzle-kit generate` will accept;
> §3 is a concrete per-corridor source matrix an engineer can wire; §4–§6 are implementable pipelines.

---

## How to use this document

- **§1 — ADRs 015–021.** The seven decisions this backbone adds on top of the foundation.
- **§2 — Schema additions.** New tables (`jurisdictions`, `bloc_membership`, `national_tariff_lines`,
  `sources`, `ingestion_runs`, `freshness_policy`, `extraction_review`) + amendments to `hs_code_data`.
- **§3 — The 5-corridor source matrix.** Per *jurisdiction × data-layer* → which source, which access tier,
  which volatility class. This is the build checklist.
- **§4 — Ingestion pipeline.** `ACQUIRE → EXTRACT → VALIDATE → ROUTE & STORE`, with the validation gates and
  the classifier/router.
- **§5 — Freshness / data-renewal policy.** Volatility classes, refresh cadence, the staleness state machine,
  the publication-watcher for document sources, change-detection, and ePing early-warning.
- **§6 — Lookup resolver.** product (HS) + target country → duty (bloc) + tax (state) + compliance, fully
  provenanced, with explicit "data unavailable" instead of guesses.
- **§7 — Rollout sequence + exit metrics.**
- **§8 — Deferred decisions (designed unknowns).** The four open forks we recorded, not yet resolved.

---

# 1. Architecture Decision Records (ADR-015 … ADR-021)

Format: **Decision / Context / Consequences.** Immutable IDs. These extend foundation ADR-001…014.

### ADR-015 — Jurisdiction model: **bloc → member-state** (not a flat country list)
- **Decision:** Replace the assumption that every fact attaches to an ISO country. Introduce a
  `jurisdictions` table whose rows are *either* a `country` (ISO-3166-1 alpha-2) *or* a `bloc`
  (`EU`, `GCC`), plus a `bloc_membership` link table. **Each fact attaches at the level where the
  real-world authority sets it.**
- **Context:** The EU is a **customs union** — one common external tariff (TARIC) applies to all 27 members,
  but **VAT is not harmonized** (17%–27% per state) and some compliance (labeling language) is national.
  The GCC is the same pattern (5% common external tariff; per-state VAT/standards). A flat country list
  would duplicate one EU duty across 27 rows and rot out of sync — the exact inconsistency that destroys
  trust in a trade tool.
- **Consequences:** **Duty** for EU/GCC attaches to the **bloc** (one row, all members inherit). **Tax** and
  **national compliance** attach to the **country**. US/UK/AUS are modeled as a `country` that is *its own*
  customs union (a bloc-of-one) so they need no special-casing. The resolver (§6) walks membership to find
  where each layer lives. **Revisit only via a new ADR** — this is load-bearing for the whole resolver.

### ADR-016 — Two-layer HS model: **international HS6 spine + national tariff lines**
- **Decision:** `hs_codes` holds the **international** Harmonized System only (levels 2/4/6 — identical
  worldwide). Country-specific tariff lines (US HTS-10, EU TARIC-10, India ITC-HS-8, UK-10, AUS-8) live in a
  **new `national_tariff_lines`** table, each linked up to its HS6 parent. (Amends foundation, which overloaded
  `hs_codes` with national codes.)
- **Context:** HS6 is the universal join key ("what is this product"); the *real* duty/measure lives at the
  national line, which differs per country and can collide numerically across countries. Storing both in one
  globally-PK'd table makes US-HTS `8471.30` and EU-TARIC `8471.30` indistinguishable.
- **Consequences:** A product resolves to one HS6 (the spine), then fans out to the destination's national
  line. National lines are unique **per jurisdiction**. The HS6 spine is the only thing the LLM classifier
  needs to produce; national-line mapping is data, not inference. **Revisit if** we ever need sub-national
  tariff splits (we don't for these 5).

### ADR-017 — Sources are a **first-class registry**, not a provenance string
- **Decision:** New `sources` table: one row per *(jurisdiction × data-layer × access-method)*. Every stored
  fact references a `source_id`. Extends foundation's `dataSource` enum (which only knew `wto/comtrade/
  grounded_llm`) — that enum stays as a coarse *class*, but the precise origin is the `sources` row.
- **Context:** The five corridors draw from ~20 distinct authoritative sources (TARIC, Access2Markets, UK
  Trade Tariff API, USITC, CBP/PGAs, ATO, ABF, GCC tariff books, UAE MOIAT, WITS, WTO ePing…), each with a
  different access method and reliability. Freshness, trust scoring, and "build vs buy" all need to reason
  about *which* source — impossible with a 4-value enum.
- **Consequences:** Adding a corridor = inserting `sources` rows + a fetcher, no schema change. Reliability
  tiering and the freshness scheduler key off `sources`. **Revisit** never — this is the registry pattern.

### ADR-018 — Tiered extraction: **API → structured file → digital-PDF text → OCR (last resort)**, every non-API path validated
- **Decision:** Acquire data by the *most structured method available*, in this strict order:
  `api` → `bulk_file` (Excel/CSV/XML) → `html_scrape` → `digital_pdf` (text-layer extraction) → `ocr`
  (scanned images only). **OCR is the floor, not the default.** Everything from `html_scrape` downward passes
  a validation gate (§4.3) before storage.
- **Context:** In a tariff/tax product a misread digit is a wrong landed-cost quote the exporter acts on —
  a liability, not a typo. OCR is the *least* accurate method (character errors on exactly the digits that
  matter). Most government tariff PDFs are *digital* (DB-generated) and yield exact characters via text
  extraction without ever invoking OCR.
- **Consequences:** UAE (PDF/bilingual, federated emirates) lands on the `digital_pdf`/`ocr` tiers; EU/UK on
  `api`. The LLM's role in extraction is **structuring** an already-acquired document into our schema — never
  inventing values (reaffirms ADR-007/§3.1 of foundation). **Revisit if** a paid structured API removes a
  document tier for a corridor (see ADR-021 + §8 build-vs-buy).

### ADR-019 — Freshness via **volatility class + publication-watcher**, with a 3-state staleness machine
- **Decision:** Every `(jurisdiction, layer)` carries a `volatility_class` (`annual` | `scheduled` |
  `event_driven`) driving its refresh cadence. Document sources additionally get a **publication-watcher**
  (poll the source page, hash the artifact, re-extract on change). Each served fact computes a staleness
  state: **FRESH → STALE (served, flagged "verify") → EXPIRED (not served as authoritative)**.
- **Context:** One global TTL is wrong: MFN duty/VAT change ~annually; FTA preferential rates phase in on a
  *known multi-year schedule* (pre-computable); compliance/NTMs are event-driven (a ban can land any day).
  PDF sources emit no freshness signal, so we must detect new publications ourselves. (Extends foundation's
  `data_tier` TTL hint into an operational scheduler.)
- **Consequences:** `freshness_policy` rows + a `pg-boss` cron (foundation ADR-002) compute the "due" set and
  re-run ingestion. WTO **ePing** SPS/TBT notifications proactively mark compliance facts STALE. The product
  always shows the *age* of a number. **Revisit** cadences per measured churn (change-detection feeds this back).

### ADR-020 — **LLM = extraction/structuring only**; it is NEVER the source of a number (reaffirm + extend ADR-007)
- **Decision:** No hard number (duty, tax rate, fee) is ever *generated* by the LLM. The LLM may (a) classify
  a product to an HS6, (b) structure an extracted document into typed rows, (c) *explain* facts already in our
  DB. Every number served has a `source_id` pointing at a non-LLM origin, or it is returned as
  **"data unavailable."**
- **Context:** Deletes the `fetchRealTradeData` anti-pattern (fabricates duty from a string hash) recorded in
  shared memory. This is the product's core trust claim: *every number is sourced.*
- **Consequences:** `grounded_llm` is allowed only for *narrative* field-groups, never `duty_*`/`tax`. The
  validation gate (§4.3) rejects any `duty_*`/`tax` row whose `source_id` resolves to an LLM-class source.

### ADR-021 — Ingestion is **hybrid**: batch pre-load common corridors + on-demand cache for the tail
- **Decision:** Batch-ingest the spine (WITS/TARIC/UK-API + per-corridor sources) on the freshness schedule so
  the common corridors are always warm in our DB. For the long tail (an unseen HS line, a rare cert), fetch
  on first request, validate, store with provenance, then serve from DB forever.
- **Context:** User-chosen hybrid. Batch = fast/reliable (no live third-party call on the hot path); on-demand
  = coverage without pre-loading the whole HS universe × 5 countries.
- **Consequences:** Two entrypoints share `server/db`: the batch worker (`server/worker.ts`, pg-boss cron) and
  the on-demand fetch invoked by the resolver (§6) on a cache miss. On-demand misses enqueue a *durable* job so
  a slow source never blocks the request beyond a timeout — the request returns "fetching / data unavailable"
  honestly and the value is there next time.

---

# 2. Schema additions (Drizzle — additive to foundation §2)

> Append to `server/db/schema.ts`. Reuses foundation imports (`pgTable`, `pgEnum`, `uuid`, `varchar`, `text`,
> `jsonb`, `timestamp`, `integer`, `boolean`, `doublePrecision`, `index`, `uniqueIndex`, `sql`). Reuses the
> existing `correctionStatus` enum for the review queue.

```ts
/* ── new enums ─────────────────────────────────────────────────────── */
export const jurisdictionKind = pgEnum('jurisdiction_kind', ['country', 'bloc']);

export const dataLayer = pgEnum('data_layer', [
  'duty_mfn',          // most-favoured-nation applied duty
  'duty_preferential', // FTA/CEPA/ECTA/GSP rate (origin-conditional)
  'tax',               // import VAT / GST / excise
  'compliance',        // NTMs, certs, documents, labeling, SPS/TBT
]);

export const accessMethod = pgEnum('access_method', [
  'api',          // structured endpoint (best)
  'bulk_file',    // Excel / CSV / XML download
  'html_scrape',  // parse HTML tables
  'digital_pdf',  // text-layer extraction (NOT ocr)
  'ocr',          // scanned image — last resort, always validated
]);

export const reliabilityTier = pgEnum('reliability_tier', [
  'authoritative_api', // govt/official structured API
  'official_file',     // govt-published Excel/CSV/XML
  'official_doc',      // govt-published PDF/HTML
  'aggregator',        // WITS/WTO multilateral aggregation
]);

export const volatilityClass = pgEnum('volatility_class', [
  'annual',       // duty/tax — quarterly check
  'scheduled',    // FTA phase-in — pre-computed schedule
  'event_driven', // compliance/NTM — subscribe + on-demand
]);

export const ingestionStatus = pgEnum('ingestion_status', [
  'running', 'succeeded', 'failed', 'partial',
]);

/* ── jurisdictions: countries AND blocs in one table (ADR-015) ─────── */
export const jurisdictions = pgTable(
  'jurisdictions',
  {
    code: varchar('code', { length: 8 }).primaryKey(), // 'US','GB','AE','AU','IN' | 'EU','GCC'
    kind: jurisdictionKind('kind').notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    isoNumeric: varchar('iso_numeric', { length: 3 }),  // countries only (WTO/Comtrade reporter)
    isCustomsUnion: boolean('is_customs_union').notNull().default(false), // bloc sets common external duty
    appliesVat: boolean('applies_vat').notNull().default(true),           // false for US (no federal VAT)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ kindIdx: index('jurisdictions_kind_idx').on(t.kind) }),
);

/* ── bloc_membership: which country belongs to which bloc ──────────── */
export const blocMembership = pgTable(
  'bloc_membership',
  {
    blocCode: varchar('bloc_code', { length: 8 }).notNull().references(() => jurisdictions.code),
    memberCode: varchar('member_code', { length: 8 }).notNull().references(() => jurisdictions.code),
  },
  (t) => ({
    pk: uniqueIndex('bloc_membership_pk').on(t.blocCode, t.memberCode),
    memberIdx: index('bloc_membership_member_idx').on(t.memberCode),
  }),
);

/* ── national_tariff_lines: HS6 spine → national HS8/HS10 (ADR-016) ── */
export const nationalTariffLines = pgTable(
  'national_tariff_lines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    jurisdictionCode: varchar('jurisdiction_code', { length: 8 })
      .notNull().references(() => jurisdictions.code), // owner: 'US','EU','GB','GCC','AU','IN'
    nationalCode: varchar('national_code', { length: 14 }).notNull(), // HTS10/TARIC10/ITC-HS8…
    hs6: varchar('hs6', { length: 6 }).notNull().references(() => hsCodes.code), // international spine
    description: text('description').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uq: uniqueIndex('national_line_uq').on(t.jurisdictionCode, t.nationalCode),
    hs6Idx: index('national_line_hs6_idx').on(t.hs6),
  }),
);

/* ── sources: first-class registry (ADR-017) ──────────────────────── */
export const sources = pgTable(
  'sources',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 128 }).notNull(),       // 'EU TARIC','UK Trade Tariff API',…
    url: text('url').notNull(),                             // the data endpoint/file/page
    watchUrl: text('watch_url'),                           // page polled for new publications (doc tiers)
    jurisdictionCode: varchar('jurisdiction_code', { length: 8 })
      .notNull().references(() => jurisdictions.code),       // bloc or country this source covers
    layer: dataLayer('layer').notNull(),
    accessMethod: accessMethod('access_method').notNull(),
    reliabilityTier: reliabilityTier('reliability_tier').notNull(),
    volatilityClass: volatilityClass('volatility_class').notNull(),
    active: boolean('active').notNull().default(true),
    notes: text('notes'),
  },
  (t) => ({
    coverageIdx: index('sources_coverage_idx').on(t.jurisdictionCode, t.layer),
  }),
);

/* ── ingestion_runs: every fetch, with change-detection hash ──────── */
export const ingestionRuns = pgTable(
  'ingestion_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sourceId: uuid('source_id').notNull().references(() => sources.id),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    status: ingestionStatus('status').notNull().default('running'),
    docHash: varchar('doc_hash', { length: 64 }), // sha256 of artifact → skip re-extract if unchanged
    version: integer('version').notNull().default(1), // monotonic per source
    rowsUpserted: integer('rows_upserted').notNull().default(0),
    rowsFlagged: integer('rows_flagged').notNull().default(0), // failed validation → extraction_review
    error: text('error'),
  },
  (t) => ({ sourceIdx: index('ingestion_runs_source_idx').on(t.sourceId, t.startedAt) }),
);

/* ── freshness_policy: per (jurisdiction, layer) renewal schedule ──── */
export const freshnessPolicy = pgTable(
  'freshness_policy',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    jurisdictionCode: varchar('jurisdiction_code', { length: 8 })
      .notNull().references(() => jurisdictions.code),
    layer: dataLayer('layer').notNull(),
    volatilityClass: volatilityClass('volatility_class').notNull(),
    refreshIntervalDays: integer('refresh_interval_days').notNull(), // annual≈90, tax≈180, event-driven≈7
    watchEnabled: boolean('watch_enabled').notNull().default(false), // publication-watcher for doc sources
    lastRefreshedAt: timestamp('last_refreshed_at', { withTimezone: true }),
    nextDueAt: timestamp('next_due_at', { withTimezone: true }),
  },
  (t) => ({
    uq: uniqueIndex('freshness_policy_uq').on(t.jurisdictionCode, t.layer),
    dueIdx: index('freshness_policy_due_idx').on(t.nextDueAt),
  }),
);

/* ── extraction_review: human-in-the-loop queue for flagged extracts ─ */
export const extractionReview = pgTable(
  'extraction_review',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ingestionRunId: uuid('ingestion_run_id').notNull().references(() => ingestionRuns.id),
    raw: jsonb('raw').$type<Record<string, unknown>>().notNull(),       // what we extracted
    proposed: jsonb('proposed').$type<Record<string, unknown>>().notNull(), // normalized candidate row
    reason: text('reason').notNull(),                                   // which gate failed
    status: correctionStatus('status').notNull().default('pending'),    // reuse foundation enum
    reviewer: uuid('reviewer').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ statusIdx: index('extraction_review_status_idx').on(t.status) }),
);
```

### 2.1 Amendments to foundation `hs_code_data`

The fact table stays, with **three added columns** (run as a migration; do not rewrite the table):

```ts
// ADD to hsCodeData:
sourceId: uuid('source_id').references(() => sources.id),        // precise origin (ADR-017)
effectiveFrom: timestamp('effective_from', { withTimezone: true }), // when the fact takes legal effect
effectiveTo: timestamp('effective_to', { withTimezone: true }),     // legal expiry → drives EXPIRED state
```

- `destinationCountry` is **reinterpreted** as a `jurisdictions.code` (8-char): it holds a **bloc** code for
  duty rows into EU/GCC and a **country** code for tax/compliance rows. (Widen the column `varchar(2)→(8)` and
  point the FK at `jurisdictions` instead of `countries`. Foundation `countries` becomes a *view/seed* of the
  `country`-kind jurisdictions during migration.)
- `effective_from/to` are the **legal** dates of the fact (distinct from `created_at`/`verified_at`, which are
  *our* ingestion timestamps). The staleness machine (§5) reads both.

---

# 3. The 5-corridor source matrix (the build checklist)

Origin = **India (IN)** throughout. Each cell = a `sources` row to create. Tier legend: 🟢 `authoritative_api`
· 🔵 `official_file` · 🟡 `official_doc` · ⚪ `aggregator`.

| Destination | duty_mfn | duty_preferential | tax | compliance |
|---|---|---|---|---|
| **EU** (bloc) | 🟢 TARIC / Access2Markets | 🟡 (India–EU FTA pending → none yet) | 🔵 per-state VAT — EU **TEDB** | 🟢 **Access2Markets** (gold standard) + ⚪ WTO ePing |
| **UK** (country) | 🟢 **UK Trade Tariff API** | 🟡 UK GSP/DCTS | 🟡 Import VAT 20% — HMRC | 🟡 gov.uk "export goods" + tariff measures |
| **US** (country) | 🔵 USITC HTS / DataWeb | 🟡 GSP (**lapsed — flag!**) | n/a federal (state sales tax — see §8) + fees MPF/HMF | 🟡 CBP + PGAs (FDA/USDA/FCC) — fragmented |
| **AUS** (country) | 🟡 ABF Working Tariff | 🔵 **India–AUS ECTA** (in force 2022) | 🟡 GST 10% — ATO | 🟡 ABF + **biosecurity** (Dept of Agriculture) |
| **UAE** (in GCC bloc) | 🟡 GCC common tariff 5% (Dubai/Federal customs) | 🟡 **India–UAE CEPA** schedule (treaty annex PDF) | 🟡 VAT 5% — Federal Tax Authority | 🟡 MOIAT/ESMA standards, Halal — sparse, PDF |
| **(spine fallback, all)** | ⚪ **WITS** / WTO Tariff Download (HS6 MFN) | — | — | ⚪ WTO **I-TIP / ePing** (SPS/TBT) |

**Reading the matrix:**
- **EU duty attaches to the `EU` bloc row**, not to 27 country rows (ADR-015). EU `tax` attaches to each
  member-state country row (27 VAT values from TEDB).
- **UAE duty attaches to the `GCC` bloc row** (flat 5%); UAE `tax`/`compliance` to the `AE` country row.
- The **spine fallback** (WITS/WTO at HS6) backstops any corridor where the national source has a gap — served
  with lower `confidence` and a clear "HS6 approximate" flag, never silently.
- Empty/lapsed cells (India–EU FTA, US GSP) are **modeled as explicit `coverage: unavailable`**, never invented.

---

# 4. Ingestion pipeline

Four stages. Batch (cron) and on-demand (resolver cache-miss) both run the same stages; they differ only in
what triggers them (ADR-021).

```
┌── ACQUIRE ──┐   ┌── EXTRACT ──┐   ┌── VALIDATE ──┐   ┌── ROUTE & STORE ──┐
│ pick source │ → │ method-per- │ → │ sanity gates │ → │ classify layer +  │
│ by tier;    │   │ format      │   │ + confidence │   │ attach to juris.  │
│ hash artifact│  │ (ADR-018)   │   │ (ADR-020)    │   │ level; provenance │
└─────────────┘   └─────────────┘   └──────────────┘   └───────────────────┘
        │                                   │ fail →  extraction_review (human)
        └── docHash unchanged → skip (no-op run, bump checked_at only)
```

### 4.1 ACQUIRE
- Resolve the `sources` row for `(jurisdiction, layer)`; prefer the highest tier with `active=true`.
- Fetch the artifact; compute `sha256` → `ingestion_runs.docHash`. **If unchanged since last run, stop** (no
  re-extract; just advance `freshness_policy.last_refreshed_at`). This is the change-detection diff (ADR-019).

### 4.2 EXTRACT (method per format — ADR-018)
- `api` → map JSON directly. `bulk_file` → parse Excel/CSV/XML (perfect fidelity). `html_scrape` → table
  parse. `digital_pdf` → **text-layer** extraction (e.g. pdfplumber-class). `ocr` → only for scanned images.
- For `digital_pdf`/`ocr`, the **LLM structures** the extracted text into candidate rows against a strict zod
  schema (foundation ADR-011) — it labels and shapes, it does **not** supply numbers (ADR-020).

### 4.3 VALIDATE (the gate that makes us trustworthy)
Every non-`api` candidate (and `api` rows too, cheaply) must pass before storage; failures go to
`extraction_review`, not to `hs_code_data`:
1. **Range sanity** — ad-valorem duty ∈ [0, 100]%; VAT/GST ∈ known band per country; no negative/null on a
   required field.
2. **Key resolves** — the HS6 exists in `hs_codes`; the national line resolves or is created with a parent.
3. **Source class** — a `duty_*`/`tax` row whose `source_id` is LLM-class is **rejected outright** (ADR-020).
4. **Cross-check** — totals/row-counts vs the document header; OCR rows re-read at higher DPI on disagreement.
5. **Confidence** — assign 0..1 by tier (api/file high, ocr lower); rows below threshold → review queue.

### 4.4 ROUTE & STORE (the "router" / classifier)
- **Classify** each validated row into a `dataLayer` (`duty_mfn` | `duty_preferential` | `tax` | `compliance`)
  and the matching `field_group`.
- **Attach at the right level (ADR-015):** `duty_*` for EU/GCC → the **bloc** jurisdiction; `tax` and national
  `compliance` → the **country**.
- **Soft-version:** write a new `hs_code_data` row with `source_id`, `effective_from/to`, `confidence`,
  `data_tier`; set the prior current row's `superseded_by`. Never overwrite (foundation pattern).

---

# 5. Freshness / data-renewal policy

The core rule (ADR-019): **layers age at different rates, so each gets a volatility class**, and every served
fact reports its age.

| Volatility class | Layers | Cadence (`refresh_interval_days`) | Mechanism |
|---|---|---|---|
| `annual` | `duty_mfn`, `tax` | ~90 (duty) / ~180 (tax) | scheduled re-fetch + docHash diff |
| `scheduled` | `duty_preferential` (CEPA/ECTA/GSP) | pre-compute the phase-in schedule | store the whole multi-year curve once; no polling |
| `event_driven` | `compliance` | ~7 + push | WTO **ePing** notifications mark facts STALE on arrival |

**Staleness state machine (computed per fact at read time):**
```
FRESH    : now < verified_at + policy.interval     AND now < effective_to  → serve normally
STALE    : past the interval, still within effect  → serve + "verify, last checked <date>" badge
EXPIRED  : now ≥ effective_to (legal expiry)       → DO NOT serve as authoritative; trigger refresh
```

**Operational pieces:**
- **Scheduler:** a `pg-boss` cron (foundation ADR-002) selects `freshness_policy` rows where `next_due_at ≤
  now()` and enqueues an ingestion run per source; advances `next_due_at` on success.
- **Publication-watcher (document sources):** for `watch_enabled` sources, poll `watch_url`, hash the linked
  artifact; on change, enqueue extraction. This is how UAE/AUS PDF tariff books get noticed (they emit no
  freshness signal).
- **ePing early-warning:** ingest WTO SPS/TBT notifications; when one matches a `(jurisdiction, HS chapter)`
  we cover, flag the affected `compliance` facts STALE *before* their TTL.
- **Change-detection feedback:** runs that produce a diff reveal which facts actually churn → tune
  `volatility_class`/intervals over time (measured, not guessed).

---

# 6. Lookup resolver (product + target country → answer)

Given `(hs6, origin=IN, destination=country)`:
1. **Resolve jurisdiction levels.** Find the destination country's customs-union bloc via `bloc_membership`
   (EU for DE/FR/…; GCC for AE; self for US/UK/AU).
2. **Duty** → read latest non-superseded `hs_code_data` where destination = **bloc-if-customs-union else
   country**, layer `duty_*`. Apply `duty_preferential` if an in-force FTA covers origin=IN (CEPA→UAE,
   ECTA→AUS); else `duty_mfn`. National line preferred; HS6 spine fallback flagged "approximate."
3. **Tax** → read `tax` at the **country** level (per-state VAT for EU; 5% AE; 10% AU; 20% UK; US → fees only).
4. **Compliance** → read `compliance` at country level (+ EU-bloc-level via Access2Markets) — certs, documents,
   SPS/TBT, labeling.
5. **Assemble with provenance.** Each field carries `{value, source_name, source_url, effective_date,
   verified_at, confidence, staleness}` (foundation §4 envelope). Any layer with no covering source returns
   **`coverage: unavailable`** — never an LLM guess (ADR-020).
6. **On cache miss** → enqueue an on-demand ingestion (ADR-021), return what we have + an honest
   "fetching"/"unavailable" marker; the value is warm on the next request.

The LLM then *explains/structures* this assembled, sourced object for the user — it is downstream of the
numbers, never their source.

---

# 7. Rollout sequence + exit metrics

**Sequence** (highest leverage first — EU forces the bloc model that UAE reuses; UAE last because PDF/Tier-4 is
hardest and benefits from a proven engine):

1. **EU** — TARIC duty (bloc) + TEDB VAT (27 states) + Access2Markets compliance. *Proves bloc→state + the
   richest compliance source.*
2. **UK** — Trade Tariff API end-to-end. *Proves the API-tier happy path fast.*
3. **US** — USITC duty + CBP/PGA compliance. *Proves fragmented multi-agency compliance.*
4. **AUS** — ABF + ECTA preferential + biosecurity. *Proves FTA phase-in + scheduled volatility.*
5. **UAE** — GCC duty (bloc, reused) + CEPA annex + MOIAT. *Proves Tier-4 PDF/OCR + publication-watcher.*

**Exit metrics (per corridor):**
- **100% sourced:** every served `duty_*`/`tax` number has a non-LLM `source_id` or returns `unavailable`. (0
  fabricated values — the `fetchRealTradeData` anti-pattern is gone.)
- **Coverage:** % of the corridor's top-N HS6 with a national line + duty + tax present.
- **Freshness SLA:** % of served facts in `FRESH` state; 0 `EXPIRED` facts served as authoritative.
- **Extraction accuracy:** sampled `digital_pdf`/`ocr` rows audited vs the source document ≥ agreed threshold
  before that source is marked `active`.
- **Resolver latency:** cache-hit p95 (DB-only) well under the foundation latency budget; cache-miss returns
  honestly within timeout.

---

# 8. Deferred decisions (designed unknowns — resolve before the relevant corridor ships)

These are the four open forks from the design discussion. Recorded, **not** yet decided — each gates only its
own corridor, so the EU/UK build can start without them.

1. **UAE compliance depth.** Ship UAE as "duty + CEPA only, compliance = best-effort/`unavailable`," or block
   UAE launch until MOIAT/Halal compliance reaches EU-level completeness? (Decides whether the hardest source
   gates a launch.)
2. **US import "tax."** Model US as "no border VAT (+ MPF/HMF fees)," or also model state-level sales tax
   (much larger scope, 50 states)? Default leaning: fees-only for v1.
3. **Build vs buy for hard tiers.** Keep 100% public-source extraction (cost/control), or buy a paid
   tariff/compliance API for the painful tiers (UAE PDFs, US-PGA compliance)? `sources.access_method` already
   abstracts this — a paid API is just another `api`-tier row.
4. **EU national labeling overlays.** Per-member-state labeling/language requirements modeled in v1, or
   "EU-level compliance via Access2Markets + a national-language-labeling flag," deepened later?

> When one is decided, record it as a new ADR (022+) here and update the affected `sources`/`freshness_policy`
> rows. Do not let an undecided fork silently expand a corridor's scope.
