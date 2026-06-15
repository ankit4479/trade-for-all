# PHASE 1 PLAN — Own Postgres DB + WTO/HS data + tree-driven classification

> **Status:** v1 (2026-06-10). The actionable build plan for Phase 1.
> **Sources of truth:** `00-foundation.md` (ADRs, conventions), `01-data-backbone.md` (data model, ingestion,
> freshness), `02-classification.md` (confidence, product gate, plain-language questions).
> **Phase 1 goal:** Stand up our **own Postgres DB**, load the **HS nomenclature** + **WTO tariffs**, and drive
> **classification from that stored data** — so a user describes a product, answers plain-language questions,
> and gets the right **global HS6** + an example image + the **WTO duty per market** + a **Comtrade demand view**.
> **Explicitly NOT in Phase 1:** national tax (VAT/GST), compliance/certs, national HS8/HS10 lines → **Phase 2**.

---

## 0. What Phase 1 delivers (definition of done)

```
user types a product
   → plain-language questions (from the HS tree) → lock global HS6
   → show: "Your product is HS 9617.00" + example image + confidence
   → user confirms the PRODUCT (not the code)
   → show: WTO MFN/bound/preferential duty per target market (from OUR db)
         + Comtrade "top demand markets" (cached aggregate)
```

Every number shown is **sourced from our DB** (loaded from WTO), never LLM-guessed. The `fetchRealTradeData`
hash-fabrication path (`gemini.ts:216`) is **not used** in Phase 1.

---

## 1. Build order (the sequence we execute)

1. **Provision Postgres** — a local dev Postgres now; Supabase (foundation ADR-003) for shared/prod later. One
   connection string in env (`DATABASE_URL`), never in the client bundle.
2. **Wire Drizzle** — `server/db/schema.ts` + `drizzle.config.ts` + `drizzle-kit generate/migrate` (foundation
   ADR-012). Migrations are the only way the schema changes.
3. **Create the Phase-1 tables** (§3): `jurisdictions`, `sources`, `ingestion_runs`, `hs_codes`, `hs_tariffs`.
   (`hs_concordance` + `freshness_policy` can come in the same migration or a follow-up.)
4. **Seed reference rows** — the 6 jurisdictions we need (IN origin + US/EU/UK/AE/AU + the `WORLD` sentinel)
   with their **numeric codes**; the WTO/UN `sources` rows.
5. **Load the HS nomenclature** — fetch the UN/WCO HS2022 reference → parse → upsert into `hs_codes`
   (chapters → headings → subheadings, ~5,300 HS6). This is the classification engine.
6. **Load WTO tariffs** — bulk CSV from `ttd.wto.org` per reporter → validate → upsert into `hs_tariffs`
   (bound + MFN applied + preferential + trade value, per HS6 × partner × year).
7. **Build the classification query** — given a product description, narrow to candidate HS6 in `hs_codes`,
   generate plain-language questions from the **branch points** between candidates (spec 02), walk to one HS6.
8. **Wire the lookup** — confirmed HS6 → read `hs_tariffs` for the duty per market; query Comtrade on-demand
   for the demand aggregate and cache it.
9. **Move Gemini server-side** — classification runs on the server (security: kill the exposed key,
   memory blocker #1), not the reason being latency.

Steps 1–6 are the "create the DB + fetch the data" work the user wants to start. 7–9 build on it.

---

## 2. The data we store (and where it comes from)

| Table | Holds | Source | Refresh |
|---|---|---|---|
| `jurisdictions` | countries + blocs + numeric codes | seed (M49 / WTO reporter codes) | static |
| `sources` | the WTO/UN source registry rows | seed | static |
| `ingestion_runs` | every fetch + hash + version | written by the loader | per run |
| `hs_codes` | the HS nomenclature tree (2/4/6-digit) | UN/WCO HS2022 reference | yearly |
| `hs_tariffs` | WTO bound/MFN/preferential + trade value | `ttd.wto.org` bulk CSV / `api.wto.org` | quarterly (applied) |

---

## 3. The Phase-1 database design

### 3.1 The tenant-ID question — **these tables have NO tenant ID** (important)

`hs_codes` and `hs_tariffs` are **shared reference data**. The WTO duty on HS 9617.00 into the US is the
**same for every user** — so there is exactly **one** copy, readable by all authenticated users. Putting a
`tenant_id` / `user_id` on them would (a) duplicate identical WTO data per user, (b) destroy the shared-cache
unit economics (shared-cache memory note), and (c) be semantically wrong.

**Tenant isolation (`user_id` + Postgres RLS) lives on the USER tables** — `user_products`, `classifications`,
`subscriptions`, `usage` (foundation §2) — **never on the reference spine.** Phase-1 reference tables get a
**read-all-authenticated** RLS policy + **write = service role only** (the loader). This matches foundation
§2's "shared reference" pattern exactly.

### 3.2 Table 1 — `hs_codes` (the nomenclature spine / classification engine)

```ts
export const hsCodes = pgTable(
  'hs_codes',
  {
    code: varchar('code', { length: 6 }).notNull(),        // '96' | '9617' | '961700'
    hsEdition: varchar('hs_edition', { length: 8 }).notNull().default('HS2022'),
    description: text('description').notNull(),
    level: integer('level').notNull(),                     // 2 (chapter) | 4 (heading) | 6 (subheading)
    parentCode: varchar('parent_code', { length: 6 }),     // self-ref: '961700'→'9617'→'96'
    section: varchar('section', { length: 4 }),            // HS section (I..XXI), optional grouping
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.code, t.hsEdition] }),    // PK = (code, edition)
    parentIdx: index('hs_codes_parent_idx').on(t.parentCode, t.hsEdition),
    levelIdx: index('hs_codes_level_idx').on(t.level),
  }),
);
```

- **Primary key:** `(code, hs_edition)` — `code` alone is NOT unique across editions (a code can mean different
  things in HS2022 vs HS2028). Composite from day one avoids a painful migration when concordance lands.
- **Foreign key:** `parent_code` self-references `hs_codes(code)` within the same edition (the tree). (Modeled
  as an app-level/composite ref; the index supports tree walks.)
- **Unique:** the PK is the natural unique key.
- **Tenant ID:** none (shared reference).

### 3.3 Table 2 — `hs_tariffs` (the WTO facts, soft-versioned)

```ts
export const dutyType = pgEnum('duty_type', ['bound', 'mfn_applied', 'preferential']);
export const rateType = pgEnum('rate_type', ['ad_valorem', 'specific', 'compound', 'free']);

export const hsTariffs = pgTable(
  'hs_tariffs',
  {
    id: uuid('id').defaultRandom().primaryKey(),           // surrogate PK (we keep version history)
    reporter: varchar('reporter', { length: 8 }).notNull() // importer / destination
      .references(() => jurisdictions.code),
    partner: varchar('partner', { length: 8 }).notNull()   // origin; 'WORLD' = MFN baseline
      .default('WORLD').references(() => jurisdictions.code),
    hs6: varchar('hs6', { length: 6 }).notNull(),          // FK → hs_codes(code) where level=6
    hsEdition: varchar('hs_edition', { length: 8 }).notNull().default('HS2022'),
    year: integer('year').notNull(),

    dutyType: dutyType('duty_type').notNull(),
    rateType: rateType('rate_type').notNull(),
    adValoremPct: doublePrecision('ad_valorem_pct'),       // 5.0 ; null for pure specific
    avePct: doublePrecision('ave_pct'),                    // ad-valorem-equivalent of specific duties
    dutyExpression: text('duty_expression'),               // raw, e.g. "$1.50/kg + 4%"

    // HS6 aggregation across national lines (WTO is HS6-level — see caveat)
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
    supersededBy: uuid('superseded_by'),                   // null = current row
  },
  (t) => ({
    // ONE current row per logical fact (the real uniqueness rule):
    currentUq: uniqueIndex('hs_tariffs_current_uq')
      .on(t.reporter, t.partner, t.hs6, t.year, t.dutyType, t.hsEdition)
      .where(sql`${t.supersededBy} IS NULL`),
    lookupIdx: index('hs_tariffs_lookup_idx')              // hot path
      .on(t.hs6, t.reporter, t.dutyType)
      .where(sql`${t.supersededBy} IS NULL`),
  }),
);
```

- **Primary key:** surrogate `id` (uuid) — because we **soft-version** (keep old rows, mark `superseded_by`),
  there are multiple physical rows per logical fact, so a natural PK won't work.
- **Foreign keys:** `reporter` & `partner` → `jurisdictions(code)`; `hs6` → `hs_codes(code)` (level-6);
  `source_id` → `sources(id)`.
- **Unique key:** a **partial unique index** on `(reporter, partner, hs6, year, duty_type, hs_edition)
  WHERE superseded_by IS NULL` — guarantees exactly **one current** tariff per logical fact while preserving
  history. This is the correct uniqueness rule under soft-versioning.
- **Tenant ID:** none (shared reference).

### 3.4 Supporting tables (needed for the FKs above)

From `01-data-backbone.md` §2 — created in the same migration so the FKs resolve:
- **`jurisdictions`** (`code` PK, `kind`, `name`, `iso_numeric`, …) — seed: `IN`(699), `US`(842), `GB`(826),
  `AU`(036), `AE`(784), the `EU`/`GCC` blocs, and a `WORLD` sentinel for MFN partner. *No tenant ID.*
- **`sources`** (`id` PK, name, url, jurisdiction, layer, access_method, …) — seed the WTO/UN rows.
- **`ingestion_runs`** (`id` PK, `source_id` FK, hash, version, status) — the loader writes one per fetch.

### 3.5 Keys at a glance (the summary you asked for)

| Table | Primary key | Foreign keys | Unique key | Tenant ID |
|---|---|---|---|---|
| `hs_codes` | `(code, hs_edition)` | `parent_code` → self | = PK | **none** (shared) |
| `hs_tariffs` | `id` (surrogate) | `reporter`,`partner`→`jurisdictions`; `hs6`→`hs_codes`; `source_id`→`sources` | partial unique `(reporter,partner,hs6,year,duty_type,hs_edition)` WHERE `superseded_by IS NULL` | **none** (shared) |
| `jurisdictions` | `code` | — | `code` | **none** (shared) |
| `sources` | `id` | `jurisdiction_code`→`jurisdictions` | — | **none** (shared) |
| `ingestion_runs` | `id` | `source_id`→`sources` | — | **none** (shared) |

> Tenant ID (`user_id` + RLS) appears later, on **user** tables (`user_products`, `classifications`), never here.

---

## 4. The accuracy caveat we build around (do not lose this)

WTO data is **HS6-level = aggregated** across national tariff lines. So `hs_tariffs` stores an
**average + min + max + line-count** per HS6, and the UI says *"MFN applied (2024): ~X% — HS6 level; exact
national line in Phase 2."* We never present the HS6 figure as the exact national rate.

---

## 5. The load / fetch pipeline (Phase 1)

```
A. NOMENCLATURE (one-time + yearly)
   UN/WCO HS2022 reference → parse tree → upsert hs_codes (chapters→headings→subheadings)

B. WTO TARIFFS (batch pre-load, then quarterly)
   ttd.wto.org bulk CSV per reporter (US/EU/UK/AE/AU)
     → parse rows → VALIDATE (range/HS exists/source-class — backbone §4.3)
     → upsert hs_tariffs (new row + supersede prior current on change; docHash skip if unchanged)
     → write ingestion_runs

C. COMTRADE DEMAND (on-demand, cached)
   on HS6 lock → query Comtrade top importers → cache the aggregate (not the firehose)
```

Refresh cadence (freshness_policy seeds): nomenclature **365d**, WTO applied **90d**, bound/preferential
**365d**; "expired = a newer year exists," not clock age.

---

## 6. Exit criteria for Phase 1

- Postgres up; Drizzle migrations create all 5 tables; reference rows seeded.
- `hs_codes` loaded with the full HS2022 tree (chapters + headings + ~5,300 HS6).
- `hs_tariffs` loaded for all 5 reporters; every served number has a `source_id` (0 fabricated).
- Classification: a product description → plain-language questions → a single HS6, with computed confidence.
- Lookup: confirmed HS6 → WTO duty per market from our DB + a Comtrade demand view.
- Gemini classification runs **server-side** (no key in the client bundle).

---

## 7. Next actions (execution — after this plan is finalized)

1. Confirm the schema/keys in §3 (esp. the no-tenant-ID call and the composite PK / partial-unique).
2. Provision Postgres + `DATABASE_URL`.
3. Write `schema.ts` + `drizzle.config.ts`; generate + run the first migration.
4. Write the seed script (jurisdictions + sources).
5. Write the HS-nomenclature loader; run it; verify the tree.
6. Write the WTO bulk loader; run it for one reporter; verify; then the rest.
