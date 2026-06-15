# 00 — Foundation Tech Spec (SINGLE SOURCE OF TRUTH)

> **Persona:** `architect` (Fowler — modular monolith first, evolutionary, reversible).
> **Status:** v1 (2026-06-09). Authored against `.ai/BUILD_PLAN.md` v2 (§1 architecture, §2 data model,
> §3 accuracy, §10 migration) and the live codebase (`server.ts`, `vite.config.ts`,
> `src/services/gemini.ts`, `firestore.rules`).
> **Scope:** Cross-cutting decisions that EVERY per-phase spec (01–06) references. Phase specs MUST NOT
> re-decide anything locked here — if a phase needs to deviate, it amends this file via a new ADR.
>
> This document is buildable: the Drizzle schema in §2 is real TypeScript an engineer can `drizzle-kit
> generate` from; §3 is real API-contract TypeScript; §4 is real shared enums/constants.

---

## How to use this document

- **Section 1 — ADRs.** Every "decide when measured" choice the plan deferred is now resolved with a
  concrete default + the trigger that would revisit it.
- **Section 2 — Canonical data model.** The complete `schema.ts`. Copy verbatim into `server/db/schema.ts`.
- **Section 3 — API conventions.** Base path, auth, envelopes, error taxonomy, pagination, the
  "designed unknown" shape, idempotency.
- **Section 4 — Provenance + confidence types.** Shared enums/types/constants imported everywhere.
- **Section 5 — Repo/project conventions.** Directory layout, env vars, migration tooling, dual-write wiring.
- **Section 6 — Spec index.** The 7 phase specs, owning skills, exit metrics.

---

# 1. Architecture Decision Records (ADRs)

Each ADR is **Decision / Context / Consequences**. Numbered, immutable IDs. Defaults chosen for
*one datastore, lightweight, reversible* (Fowler). GA models only — no `*-preview`.

### ADR-001 — API framework: **Express 5** (not Fastify)
- **Decision:** Keep Express (already `server.ts`), upgrade to Express 5.x, structured `server/` layout (§5).
- **Context:** `server.ts` is already Express. The hot path is I/O-bound (DB, Gemini, WTO/Comtrade), so
  Fastify's raw req/s advantage is irrelevant; the cost lever is cache-hit-rate (BUILD_PLAN §0), not framework
  throughput. Strangler-Fig (§10) wants the *smallest reversible* step — rewriting to Fastify is gold-plating.
- **Consequences:** Reuse existing middleware ecosystem (helmet, express-rate-limit, zod validators). SSE via
  raw `res.write` (§ADR-010). **Revisit if** p95 framework overhead ever shows up in latency budgets (§ADR-013) —
  measured, not assumed.

### ADR-002 — Job queue: **pg-boss** on the same Postgres (not BullMQ/Redis)
- **Decision:** `pg-boss` for `analysis_jobs`, refresh, re-embed, cache pre-warm, eval runs.
- **Context:** BUILD_PLAN §1 explicitly says "ONE datastore — add Redis only when measured." pg-boss gives
  transactional enqueue alongside the same writes, exactly-once semantics, scheduled (cron) jobs, and survives
  restarts — all on the Postgres we already run.
- **Consequences:** No Redis to operate/secure/bill. Job state is queryable via SQL for the COGS dashboard.
  Worker process is a second entrypoint (`server/worker.ts`) sharing `server/db`. **Revisit (add BullMQ+Redis)
  only if** a hot path proves pg-boss latency/throughput is the bottleneck under load test.

### ADR-003 — Postgres host: **Supabase** (not Neon)
- **Decision:** Supabase Postgres 15+ with `pgvector` and `pg_cron` extensions.
- **Context:** We need RLS (BUILD_PLAN §7 tenant isolation), pgvector, and a managed Postgres. Supabase ships
  RLS-first, pgvector, point-in-time restore, and connection pooling (Supavisor). We are NOT using Supabase
  Auth (we keep **Firebase Auth** — §ADR-006) or Supabase client-side SDK (no direct client writes, BUILD_PLAN §0).
  Supabase is used purely as managed Postgres + RLS + pooler.
- **Consequences:** RLS policies are defined in migrations (per-table intent noted in §2). The API connects with a
  **service role** behind pooler and sets `request.jwt.claims`/`SET LOCAL app.user_id` per request to drive RLS
  (§5.5). Reversible: it's plain Postgres + Drizzle; moving to Neon later is a connection-string + extension swap.
  **Revisit if** Supabase pricing or pooler limits bite at scale.

### ADR-004 — KMS / secrets provider: **Google Cloud KMS** envelope encryption
- **Decision:** GCP KMS for envelope encryption of BYOK keys (`user_api_keys.ciphertext`); secrets (Gemini key,
  WTO/Comtrade keys, DB URL, Stripe keys) in **GCP Secret Manager**, injected as env at boot.
- **Context:** The project is already on Firebase/GCP (`firebase-applet-config.json`, Firestore). Staying in GCP
  avoids a second cloud trust boundary. Envelope pattern: KMS holds the key-encryption-key (KEK); we generate a
  per-record data-encryption-key (DEK), encrypt the plaintext with the DEK (AES-256-GCM), encrypt the DEK with the
  KEK, store `{ciphertext, encrypted_dek, iv, auth_tag, kek_version}`. Plaintext keys NEVER touch the browser
  (BUILD_PLAN §0/§6).
- **Consequences:** One IAM principal (the API service account) can `Decrypt`; rotation = new KEK version, lazy
  re-wrap on next use. **Revisit if** we move clouds (the `KmsClient` interface in `server/services/crypto.ts`
  abstracts the provider so swapping to AWS KMS/Vault is a single-file change).

### ADR-005 — Embedding model + dimension: **`gemini-embedding-001` @ 1536 dims** (MRL-truncated)
- **Decision:** Embeddings via GA `gemini-embedding-001`, output truncated (Matryoshka) to **1536 dimensions**,
  L2-normalized before storage. Stored in `embeddings.embedding vector(1536)`.
- **Context:** `gemini-embedding-001` is the GA Gemini embedding model (default 3072-dim, MRL-truncatable to 1536
  or 768 without quality collapse — [Gemini embeddings docs](https://ai.google.dev/gemini-api/docs/models/gemini-embedding-001)).
  1536 halves storage/index size vs 3072 and keeps pgvector HNSW comfortably under the 2000-dim indexable limit,
  with negligible recall loss for our reference corpus. 768 was rejected as too lossy for legal/tariff nuance.
- **Consequences:** The dimension is **frozen** in the column type and the index. Changing it is a re-embed +
  migration (the incremental re-embed worker, BUILD_PLAN §3, makes this tractable but it's not free). Always pass
  `outputDimensionality: 1536` and `taskType` (`RETRIEVAL_DOCUMENT` for corpus, `RETRIEVAL_QUERY` for queries) on
  every embed call. **Revisit only via a new ADR** (dimension is load-bearing for the index).

### ADR-006 — Auth: **Firebase Auth** (ID-token bearer), server-verified; RBAC via custom claims
- **Decision:** Keep Firebase Auth. Browser sends the Firebase **ID token** as `Authorization: Bearer <token>`
  on every API call. The API verifies it with the Firebase Admin SDK (`server/middleware/auth.ts`) and provisions
  the `users` row on first login (mirrors `uid`). Role/plan live in **Firebase custom claims** (server-set),
  replacing the hardcoded admin email in `firestore.rules` and `gemini.ts`.
- **Context:** Migration is Strangler-Fig (§10): "retire Firestore caching, **keep Firebase Auth**." No reason to
  rip out a working IdP. Custom claims give us server-truth RBAC without a client-trusted authz path (BUILD_PLAN §7).
- **Consequences:** No session cookies for the API (stateless bearer). Stripe webhooks set custom claims on
  plan change (BUILD_PLAN §8). The hardcoded `amankr4883@gmail.com` admin check is **deleted** — admin is a claim.

### ADR-007 — LLM models: **GA Gemini only** — `gemini-2.5-flash` + `gemini-2.5-pro` (kill all `*-preview`)
- **Decision:** Synthesis/classification/pulse → **`gemini-2.5-flash`** (GA). Complex reasoning ("ask expert",
  conflict adjudication) → **`gemini-2.5-pro`** (GA). No preview models anywhere. Model IDs are centralized in
  `server/services/llm/models.ts` so a model-drift gate (BUILD_PLAN §3.5) can re-run the golden set on change.
- **Context:** The live `gemini.ts` calls `gemini-3-flash-preview` and `gemini-3.1-pro-preview` — **forbidden**
  by BUILD_PLAN §3.5 ("Pin GA models (no `*-preview`)"). `gemini-2.5-flash` and `gemini-2.5-pro` are the current
  GA thinking-model line ([Gemini 2.5 GA](https://cloud.google.com/blog/products/ai-machine-learning/gemini-2-5-flash-lite-flash-pro-ga-vertex-ai)).
- **Consequences:** All Gemini calls move server-side (BUILD_PLAN §0; today the key is bundled via Vite `define`
  in `vite.config.ts` — **removed** in Phase 0). The LLM has **zero DB-write capability** (BUILD_PLAN §7, OWASP
  LLM01). Hard numbers (duty/tax) come from WTO/Comtrade APIs, never the LLM (§3.1).

### ADR-008 — Rerank model: **`gemini-2.5-flash` as LLM-reranker** (no dedicated cross-encoder yet)
- **Decision:** After hybrid retrieve (keyword + vector), rerank candidates with a structured `gemini-2.5-flash`
  scoring call (each candidate → relevance score 0–1, JSON output), top-K to synthesis. Encapsulated behind a
  `Reranker` interface in `server/services/rag/rerank.ts`.
- **Context:** Standing up a separate cross-encoder/managed rerank service violates "one datastore, lightweight"
  and adds a vendor. An LLM-reranker on the GA flash model is good enough to clear the retrieval-confidence gate
  (BUILD_PLAN §3.1) and is measurable by the eval harness (retrieval relevance metric, §3.5).
- **Consequences:** Rerank cost is a Gemini call — counted in COGS and gated by the cost circuit-breaker
  (BUILD_PLAN §9). **Revisit if** the eval harness shows reranking is the accuracy bottleneck; the `Reranker`
  interface lets us drop in a hosted reranker (e.g. Vertex ranking API) without touching call sites.

### ADR-009 — Vector index: **HNSW** with `vector_cosine_ops` (not IVFFlat)
- **Decision:** `pgvector` **HNSW** index on `embeddings.embedding`, cosine distance, separate index per corpus
  scope (shared vs private filtered by `partial index`/`WHERE`). Params: `m = 16`, `ef_construction = 64`;
  query-time `hnsw.ef_search = 100` (tunable).
- **Context:** HNSW gives better recall/latency at our (modest, growing) corpus size and—critically—**does not
  need a training step or periodic `REINDEX`** the way IVFFlat does after large inserts. With incremental re-embed
  (BUILD_PLAN §3) rows change continuously; HNSW handles incremental inserts gracefully. Embeddings are
  L2-normalized (§ADR-005) so cosine == dot-product order.
- **Consequences:** Higher build memory than IVFFlat, acceptable at our scale. 1536 dims is well under pgvector's
  2000-dim HNSW limit (§ADR-005). **Revisit if** the corpus grows past ~1M rows where IVFFlat's smaller footprint
  might win — measured.

### ADR-010 — Streaming transport: **SSE** (not WebSocket) for analysis streaming
- **Decision:** Server-Sent Events over a plain `GET /api/v1/jobs/:id/stream` (`text/event-stream`). One-way
  server→client is all the analysis stream needs (BUILD_PLAN §4 "stream the analysis").
- **Context:** Analysis is server→client only; SSE is simpler, proxy-friendly, auto-reconnects, and works through
  the existing Express server without a WS upgrade path. WebSocket adds bidirectional complexity we don't need.
- **Consequences:** Each streamed section is `event: section\ndata: <json>\n\n`. The job survives navigation via
  `analysis_jobs` state (client re-subscribes by job id). Heartbeat comment line every 15s to keep proxies open.
  **Revisit if** we add a feature requiring client→server mid-stream messaging.

### ADR-011 — Validation: **zod** at every boundary; LLM output is schema-validated
- **Decision:** `zod` validates (a) all inbound request bodies/queries/params, (b) all LLM structured output
  before it is trusted or cached. Shared schemas in `server/schemas/`.
- **Context:** BUILD_PLAN §7 (input validation; prompt-injection defense — "schema-validated output").
- **Consequences:** A failed LLM-output parse → treated as a *miss/weak* result, never cached, never served as
  fact (feeds the "designed unknown" state, §3.5 of this doc).

### ADR-012 — ORM & query safety: **Drizzle ORM only**, parameterized, incl. pgvector
- **Decision:** Drizzle ORM for all DB access; raw SQL only through Drizzle's parameterized `sql` template.
  pgvector ops via `drizzle-orm` + a typed `vector` column helper.
- **Context:** BUILD_PLAN §7 (SQL injection — "parameterized/Drizzle only, incl. pgvector"). Architect reference
  stack (architect.md) names Drizzle.
- **Consequences:** No string-concatenated SQL anywhere. Migrations via `drizzle-kit` (§5.4).

### ADR-013 — Frontend build: **keep React + Vite**, evolve to PWA + code-split (no framework swap)
- **Decision:** Keep React + Vite. Add PWA (service worker + IndexedDB/Dexie, BUILD_PLAN §5), route-level
  code-splitting, latency budgets in CI (JS ≤170KB initial, LCP<2.5s, INP<200ms — BUILD_PLAN §4.5).
- **Context:** The app is already React+Vite (`vite.config.ts`). Architect.md reference stack confirms it. The
  Phase-0 change is *removing* the client-side Gemini key (`define` block), not changing the framework.
- **Consequences:** `vite.config.ts` `define` for `GEMINI_API_KEY` is **deleted** (Phase 0). All AI goes through
  the API. The Vite middleware in `server.ts` (dev) is preserved.

### ADR-014 — Idempotency: **`Idempotency-Key` header + `events`/dedup table** for all writes & webhooks
- **Decision:** Every state-changing API write and every Stripe webhook carries an idempotency key; the server
  records processed keys and returns the prior result on replay (§3.7).
- **Context:** BUILD_PLAN §8 ("idempotent webhooks"). Stripe retries; SSE clients retry; offline sync (BUILD_PLAN
  §5) replays writes.
- **Consequences:** A small `idempotency_keys` concern is folded into the write path; Stripe events deduped by
  `stripe_event_id` (see `subscriptions`/`events` usage in §2 and §3.7).

---

# 2. Canonical data model — `server/db/schema.ts` (Drizzle)

> Copy this verbatim. It is the schema **every** phase references. All tenant tables carry `user_id` and are
> intended to be protected by **Postgres RLS** keyed on `app.user_id` (set per-request, §5.5). RLS intent is
> noted per table as a comment. `updated_at` provides soft-versioning (query latest); we never hard-delete
> reference data — we supersede it.

```typescript
// server/db/schema.ts
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  integer,
  bigint,
  doublePrecision,
  boolean,
  timestamp,
  jsonb,
  date,
  index,
  uniqueIndex,
  primaryKey,
  customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/* ------------------------------------------------------------------ *
 * pgvector custom column type (1536 dims — see ADR-005).
 * ------------------------------------------------------------------ */
export const vector = (name: string, dimensions: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `vector(${dimensions})`;
    },
    toDriver(value: number[]): string {
      return `[${value.join(',')}]`;
    },
    fromDriver(value: string): number[] {
      return value.slice(1, -1).split(',').map(Number);
    },
  })(name);

/* ------------------------------------------------------------------ *
 * Enums (mirror the shared TS enums in §4 — keep in sync).
 * ------------------------------------------------------------------ */
export const userRole = pgEnum('user_role', ['user', 'expert', 'admin']);
export const planTier = pgEnum('plan_tier', ['free', 'starter', 'growth', 'business']);

export const dataSource = pgEnum('data_source', [
  'expert_override', // highest precedence (BUILD_PLAN §3.3)
  'wto',
  'comtrade',
  'grounded_llm',
]);
export const dataTier = pgEnum('data_tier', [
  'trade_pulse', // 1–24h TTL
  'duty_tariff', // ~12mo TTL
  'classification', // ~6mo TTL
  'country_standard', // ~6mo TTL
  'expert_override', // never auto-expire
]);
export const corpusScope = pgEnum('corpus_scope', ['shared', 'private']);
export const correctionSource = pgEnum('correction_source', ['expert', 'user_flag']);
export const correctionStatus = pgEnum('correction_status', ['pending', 'approved', 'rejected']);
export const jobStatus = pgEnum('job_status', ['queued', 'running', 'streaming', 'done', 'failed']);
export const apiKeyStatus = pgEnum('api_key_status', ['active', 'invalid', 'revoked']);
export const subscriptionStatus = pgEnum('subscription_status', [
  'trialing', 'active', 'past_due', 'canceled', 'incomplete', 'unpaid',
]);

/* ================================================================== *
 * users — mirrors Firebase uid; provisioned on first verified login.
 * RLS: a row is readable/writable only when app.user_id = users.id.
 * Admin/expert bypass via role claim handled in policy.
 * ================================================================== */
export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    firebaseUid: varchar('firebase_uid', { length: 128 }).notNull(),
    email: varchar('email', { length: 320 }).notNull(),
    displayName: varchar('display_name', { length: 256 }),
    role: userRole('role').notNull().default('user'),
    plan: planTier('plan').notNull().default('free'),
    companyName: varchar('company_name', { length: 256 }),
    originCountry: varchar('origin_country', { length: 2 }), // ISO-3166-1 alpha-2
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    firebaseUidUq: uniqueIndex('users_firebase_uid_uq').on(t.firebaseUid),
    emailUq: uniqueIndex('users_email_uq').on(t.email),
  }),
);

/* ================================================================== *
 * user_products — per-user classification history.
 * Powers "same product again → instant".  RLS: user_id = app.user_id.
 * ================================================================== */
export const userProducts = pgTable(
  'user_products',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    query: text('query').notNull(),
    hsCode: varchar('hs_code', { length: 12 }).references(() => hsCodes.code),
    clarifiers: jsonb('clarifiers').$type<Record<string, string>>().default({}), // clarifying Q&A
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('user_products_user_idx').on(t.userId),
    userHsIdx: index('user_products_user_hs_idx').on(t.userId, t.hsCode),
  }),
);

/* ================================================================== *
 * countries — per-country reference (laws, guidelines, taxes).
 * RLS: shared reference — readable by any authenticated user; writable
 * only by service role / expert+admin.
 * ================================================================== */
export const countries = pgTable(
  'countries',
  {
    code: varchar('code', { length: 2 }).primaryKey(), // ISO-3166-1 alpha-2
    name: varchar('name', { length: 128 }).notNull(),
    numericCode: varchar('numeric_code', { length: 3 }), // WTO/Comtrade reporter code (zero-padded)
    laws: jsonb('laws').$type<Record<string, unknown>>().default({}),
    guidelines: jsonb('guidelines').$type<Record<string, unknown>>().default({}),
    taxes: jsonb('taxes').$type<Record<string, unknown>>().default({}),
    dataTier: dataTier('data_tier').notNull().default('country_standard'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    numericIdx: index('countries_numeric_idx').on(t.numericCode),
  }),
);

/* ================================================================== *
 * hs_codes — canonical HS entries.
 * RLS: shared reference (read all auth, write service/expert).
 * ================================================================== */
export const hsCodes = pgTable(
  'hs_codes',
  {
    code: varchar('code', { length: 12 }).primaryKey(), // HS6 or national HS8/HS10
    description: text('description').notNull(),
    parentCode: varchar('parent_code', { length: 12 }), // self-ref for the HS tree
    level: integer('level').notNull().default(6), // 2/4/6/8/10
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    parentIdx: index('hs_codes_parent_idx').on(t.parentCode),
  }),
);

/* ================================================================== *
 * hs_code_data — product-level data BY HS code + route, soft-versioned.
 * Each row carries PROVENANCE (source, source_url, verified_at,
 * confidence, data_tier).  Query the LATEST non-superseded row per
 * (hs_code, origin, destination, field_group).
 * RLS: shared reference (read all auth, write service/expert).
 * ================================================================== */
export const hsCodeData = pgTable(
  'hs_code_data',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    hsCode: varchar('hs_code', { length: 12 }).notNull().references(() => hsCodes.code),
    originCountry: varchar('origin_country', { length: 2 }).references(() => countries.code),
    destinationCountry: varchar('destination_country', { length: 2 }).references(() => countries.code),
    fieldGroup: varchar('field_group', { length: 64 }).notNull(), // e.g. 'duty_rates','trade_laws','packaging'
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),

    // --- provenance columns (BUILD_PLAN §2/§3) ---
    source: dataSource('source').notNull(),
    sourceUrl: text('source_url'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    confidence: doublePrecision('confidence').notNull().default(0), // 0..1 (see §4)
    dataTier: dataTier('data_tier').notNull(),

    // --- soft-versioning ---
    supersededBy: uuid('superseded_by'), // -> hs_code_data.id of the newer row, null = current
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // latest-lookup key: route + field group; filter supersededBy IS NULL in query.
    routeIdx: index('hs_code_data_route_idx').on(
      t.hsCode, t.originCountry, t.destinationCountry, t.fieldGroup,
    ),
    currentIdx: index('hs_code_data_current_idx')
      .on(t.hsCode, t.fieldGroup)
      .where(sql`${t.supersededBy} IS NULL`),
    tierIdx: index('hs_code_data_tier_idx').on(t.dataTier, t.verifiedAt),
  }),
);

/* ================================================================== *
 * data_corrections — human-in-the-loop overrides (compounding accuracy).
 * Approved corrections WIN over cache + LLM for everyone.
 * RLS: user_flag rows readable by their author; expert/admin see all;
 * write of status transitions restricted to expert/admin.
 * ================================================================== */
export const dataCorrections = pgTable(
  'data_corrections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    hsCode: varchar('hs_code', { length: 12 }).references(() => hsCodes.code),
    originCountry: varchar('origin_country', { length: 2 }).references(() => countries.code),
    destinationCountry: varchar('destination_country', { length: 2 }).references(() => countries.code),
    fieldGroup: varchar('field_group', { length: 64 }).notNull(),
    field: varchar('field', { length: 128 }).notNull(),
    correctedValue: jsonb('corrected_value').notNull(),
    rationale: text('rationale'),
    sourceUrl: text('source_url'),
    source: correctionSource('source').notNull(),
    submittedBy: uuid('submitted_by').references(() => users.id),
    reviewer: uuid('reviewer').references(() => users.id),
    status: correctionStatus('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    routeIdx: index('data_corrections_route_idx').on(
      t.hsCode, t.originCountry, t.destinationCountry, t.fieldGroup, t.field,
    ),
    statusIdx: index('data_corrections_status_idx').on(t.status),
    approvedLookupIdx: index('data_corrections_approved_idx')
      .on(t.hsCode, t.fieldGroup, t.field)
      .where(sql`${t.status} = 'approved'`),
  }),
);

/* ================================================================== *
 * embeddings — pgvector + FK to source row.  Two corpora:
 * SHARED reference (safe) vs PRIVATE per-user (never mixed).
 * Incremental re-embed: only changed rows (track sourceUpdatedAt).
 * RLS: scope='shared' readable by all auth; scope='private' only when
 * user_id = app.user_id.  Retrieval queries MUST filter by scope+user.
 * ================================================================== */
export const embeddings = pgTable(
  'embeddings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    scope: corpusScope('scope').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }), // null for shared
    sourceTable: varchar('source_table', { length: 64 }).notNull(), // e.g. 'hs_code_data'
    sourceId: uuid('source_id').notNull(),
    chunk: text('chunk').notNull(), // sanitized text (prompt-injection defense, BUILD_PLAN §7)
    embedding: vector('embedding', 1536).notNull(), // ADR-005
    model: varchar('model', { length: 64 }).notNull().default('gemini-embedding-001'),
    sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }), // re-embed trigger
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // HNSW vector index (ADR-009). Cosine ops; embeddings are L2-normalized.
    hnsw: index('embeddings_hnsw_idx')
      .using('hnsw', t.embedding.op('vector_cosine_ops'))
      .with({ m: 16, ef_construction: 64 }),
    scopeUserIdx: index('embeddings_scope_user_idx').on(t.scope, t.userId),
    sourceIdx: index('embeddings_source_idx').on(t.sourceTable, t.sourceId),
  }),
);

/* ================================================================== *
 * user_api_keys — encrypted BYOK tokens (ciphertext ONLY).
 * Envelope-encrypted via GCP KMS (ADR-004).  RLS: user_id = app.user_id.
 * ================================================================== */
export const userApiKeys = pgTable(
  'user_api_keys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 32 }).notNull(), // 'wto' | 'comtrade'
    ciphertext: text('ciphertext').notNull(), // AES-256-GCM(plaintext, DEK)
    encryptedDek: text('encrypted_dek').notNull(), // KMS-wrapped DEK
    iv: varchar('iv', { length: 64 }).notNull(),
    authTag: varchar('auth_tag', { length: 64 }).notNull(),
    kekVersion: varchar('kek_version', { length: 64 }).notNull(),
    status: apiKeyStatus('status').notNull().default('active'),
    lastValidatedAt: timestamp('last_validated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userProviderUq: uniqueIndex('user_api_keys_user_provider_uq').on(t.userId, t.provider),
  }),
);

/* ================================================================== *
 * subscriptions — Stripe state.  RLS: user_id = app.user_id.
 * ================================================================== */
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    stripeCustomerId: varchar('stripe_customer_id', { length: 64 }),
    stripeSubscriptionId: varchar('stripe_subscription_id', { length: 64 }),
    plan: planTier('plan').notNull().default('free'),
    status: subscriptionStatus('status').notNull().default('active'),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userUq: uniqueIndex('subscriptions_user_uq').on(t.userId),
    stripeCustomerIdx: index('subscriptions_stripe_customer_idx').on(t.stripeCustomerId),
    stripeSubUq: uniqueIndex('subscriptions_stripe_sub_uq').on(t.stripeSubscriptionId),
  }),
);

/* ================================================================== *
 * usage — per-user per-month meters (meter on deep analyses, §8).
 * Doubles as quota gate + cost control.  RLS: user_id = app.user_id.
 * ================================================================== */
export const usage = pgTable(
  'usage',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    periodMonth: varchar('period_month', { length: 7 }).notNull(), // 'YYYY-MM'
    deepAnalyses: integer('deep_analyses').notNull().default(0),
    classifications: integer('classifications').notNull().default(0),
    cogsMicroUsd: bigint('cogs_micro_usd', { mode: 'number' }).notNull().default(0), // tracked COGS
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userPeriodUq: uniqueIndex('usage_user_period_uq').on(t.userId, t.periodMonth),
  }),
);

/* ================================================================== *
 * analysis_jobs — async long-op state (queued|running|streaming|done|
 * failed) + partial results.  Subscribed via SSE (ADR-010).
 * RLS: user_id = app.user_id.
 * ================================================================== */
export const analysisJobs = pgTable(
  'analysis_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 64 }).notNull(), // 'deep_analysis' | 'multi_market' ...
    input: jsonb('input').$type<Record<string, unknown>>().notNull(),
    status: jobStatus('status').notNull().default('queued'),
    partialResult: jsonb('partial_result').$type<Record<string, unknown>>().default({}),
    result: jsonb('result').$type<Record<string, unknown>>(),
    error: text('error'),
    idempotencyKey: varchar('idempotency_key', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userStatusIdx: index('analysis_jobs_user_status_idx').on(t.userId, t.status),
    idempotencyUq: uniqueIndex('analysis_jobs_idempotency_uq').on(t.userId, t.idempotencyKey),
  }),
);

/* ================================================================== *
 * events — product analytics (cache-hit, COGS, funnel) AND the
 * webhook/idempotency dedup ledger (ADR-014).  Append-only.
 * RLS: read restricted to admin; insert by service role only.
 * ================================================================== */
export const events = pgTable(
  'events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    type: varchar('type', { length: 64 }).notNull(), // 'cache_hit' | 'cache_miss' | 'cogs' | 'funnel' | 'webhook'
    payload: jsonb('payload').$type<Record<string, unknown>>().default({}),
    // idempotency / webhook dedup
    dedupeKey: varchar('dedupe_key', { length: 191 }), // e.g. stripe_event_id or Idempotency-Key
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    typeIdx: index('events_type_idx').on(t.type, t.createdAt),
    userIdx: index('events_user_idx').on(t.userId),
    dedupeUq: uniqueIndex('events_dedupe_uq').on(t.dedupeKey), // null allowed (partial unique in PG)
  }),
);
```

**RLS rollout note (for Phase 1 / `data-engineer` + `security-engineer`):** Drizzle does not emit RLS policies.
Add an `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` SQL block per tenant table in the first
migration, keyed on `current_setting('app.user_id', true)::uuid`. The API sets it per request:
`SET LOCAL app.user_id = $1; SET LOCAL app.role = $2;` inside the request transaction (§5.5). Shared-reference
tables (`countries`, `hs_codes`, `hs_code_data`, shared `embeddings`) get a read-all-authenticated policy + a
write policy gated on `app.role IN ('expert','admin')` or service role.

---

# 3. API conventions

### 3.1 Base path & versioning
- All API routes under **`/api/v1`**. The existing `/api/health`, `/api/trade/*`, `/api/trade/status` are
  migrated under `/api/v1` (legacy paths kept as thin aliases during Strangler-Fig, removed at end of §10).
- Breaking changes bump to `/api/v2`; additive changes do not.

### 3.2 Auth header (standard)
- Every authenticated request: `Authorization: Bearer <Firebase ID token>` (§ADR-006).
- `server/middleware/auth.ts` verifies via Firebase Admin, loads/provisions the `users` row, attaches
  `req.auth = { userId, firebaseUid, role, plan }`, and opens the request transaction with
  `SET LOCAL app.user_id` / `app.role` (§5.5). Missing/invalid token → `401 UNAUTHENTICATED`.

### 3.3 Success envelope
```typescript
// server/http/envelope.ts
export interface ApiSuccess<T> {
  ok: true;
  data: T;
  meta?: {
    requestId: string;
    // present on list endpoints (§3.6)
    pagination?: { nextCursor: string | null; limit: number };
    // present on any served reference value (BUILD_PLAN §0 trust metric: 100% sourced)
    provenance?: Provenance;          // see §4
    freshness?: Freshness;            // see §4
  };
}
```
HTTP 200/201. `requestId` echoes the `X-Request-Id` (generated if absent) for tracing.

### 3.4 Error envelope + taxonomy
```typescript
export interface ApiError {
  ok: false;
  error: {
    code: ErrorCode;        // machine-readable, stable
    message: string;        // human-readable, safe to show
    details?: unknown;      // zod issues, upstream error, etc. (never secrets)
    requestId: string;
  };
}

export type ErrorCode =
  | 'UNAUTHENTICATED'        // 401 — missing/invalid Firebase token
  | 'PERMISSION_DENIED'      // 403 — RBAC/plan gate (server-truth)
  | 'NOT_FOUND'             // 404
  | 'VALIDATION_FAILED'      // 422 — zod rejected input
  | 'QUOTA_EXCEEDED'         // 429 — plan/usage quota (BUILD_PLAN §8/§9)
  | 'RATE_LIMITED'           // 429 — per-user/IP rate limit
  | 'COST_CIRCUIT_OPEN'      // 503 — cost circuit-breaker tripped (BUILD_PLAN §9)
  | 'UPSTREAM_UNAVAILABLE'   // 502 — WTO/Comtrade/Gemini failure (serve cached/partial)
  | 'CONFLICT'              // 409 — idempotency / state conflict
  | 'DATA_UNAVAILABLE'       // 200 BODY-LEVEL ONLY — see §3.5 (NOT an HTTP error)
  | 'INTERNAL';             // 500
```
**Rule:** Upstream/AI failures degrade gracefully (BUILD_PLAN §4.6) — prefer serving cached/partial with a
clear flag over a hard error. A genuine *absence of data* is **not** an error (next).

### 3.5 The "designed unknown" response shape (BUILD_PLAN principle 6)
"Never blank, never guessed." When retrieval-confidence is weak, sources conflict beyond tolerance, or no source
exists, the endpoint returns **HTTP 200** with a typed unknown-state in `data` — never a fabrication, never a 500.
```typescript
export type Resolved<T> =
  | { state: 'known'; value: T; provenance: Provenance; freshness: Freshness }
  | { state: 'low_confidence'; partial: Partial<T>; reason: string; provenance: Provenance; freshness: Freshness }
  | { state: 'sources_disagree'; candidates: Array<{ value: T; provenance: Provenance }>; servedValue: T } // §3.3 precedence
  | { state: 'unavailable'; reason: string }; // "data unavailable for this route"
```
The LLM fabricated-data fallback in `gemini.ts:216–226` is **deleted** (BUILD_PLAN §3.6) — its job is replaced by
`{ state: 'unavailable' }`.

### 3.6 Pagination (cursor-based)
- List endpoints accept `?limit=<1..100, default 25>&cursor=<opaque>`.
- Response `meta.pagination = { nextCursor, limit }`; `nextCursor: null` means end.
- Cursor encodes `(createdAt, id)` keyset (stable under inserts). No offset pagination (it drifts).

### 3.7 Idempotency (writes + webhooks) — §ADR-014
- **Client writes:** state-changing requests SHOULD send `Idempotency-Key: <uuid>`. The server checks `events`
  (`type='webhook'`/`'idempotency'`, `dedupeKey`) — first occurrence processes and records; replays return the
  stored result with `200`/`409 CONFLICT` semantics. `analysis_jobs.idempotencyKey` dedupes job creation per user.
- **Stripe webhooks:** verify signature, then dedupe on `stripe_event_id` written to `events.dedupeKey`
  (unique). Already-seen event → `200` no-op. Webhook handler updates `subscriptions` and sets Firebase custom
  claims (plan/role) — all inside one transaction.

### 3.8 SSE streaming contract (§ADR-010)
- `GET /api/v1/jobs/:id/stream` → `Content-Type: text/event-stream`.
- Events: `event: status` (job lifecycle), `event: section` (a rendered analysis section), `event: done`,
  `event: error`. `data:` is JSON. Heartbeat `:` comment every 15s. Client resubscribes by job id after drop;
  server replays from `analysis_jobs.partialResult`.

---

# 4. Provenance + confidence types (shared) — `shared/provenance.ts`

> Imported by both `server/` and `src/` (the client renders the source + freshness stamp — BUILD_PLAN §0 trust
> metric). Keep in sync with the pgEnums in §2.

```typescript
// shared/provenance.ts

/** Source-of-truth precedence (BUILD_PLAN §3.3). Lower index = higher trust. */
export enum DataSource {
  ExpertOverride = 'expert_override', // wins over everything
  WTO = 'wto',                        // authoritative API
  Comtrade = 'comtrade',              // derived
  GroundedLLM = 'grounded_llm',       // synthesis over retrieved+cited rows
}

/** Strict precedence order — index 0 is highest trust. Use for §3.3 conflict resolution. */
export const SOURCE_PRECEDENCE: readonly DataSource[] = [
  DataSource.ExpertOverride,
  DataSource.WTO,
  DataSource.Comtrade,
  DataSource.GroundedLLM,
] as const;

export function higherPrecedence(a: DataSource, b: DataSource): DataSource {
  return SOURCE_PRECEDENCE.indexOf(a) <= SOURCE_PRECEDENCE.indexOf(b) ? a : b;
}

/** Freshness tier (BUILD_PLAN §3.2). */
export enum DataTier {
  TradePulse = 'trade_pulse',         // news/sanctions
  DutyTariff = 'duty_tariff',         // annual schedules
  Classification = 'classification',  // HS classification
  CountryStandard = 'country_standard',
  ExpertOverride = 'expert_override', // never auto-expire
}

/** TTL per tier, in MILLISECONDS (BUILD_PLAN §3.2 table). */
export const FRESHNESS_TTL_MS: Record<DataTier, number | null> = {
  [DataTier.TradePulse]: 24 * 60 * 60 * 1000,            // 1–24h → use upper bound; revalidate sooner in bg
  [DataTier.DutyTariff]: 365 * 24 * 60 * 60 * 1000,      // ~12 months
  [DataTier.Classification]: 182 * 24 * 60 * 60 * 1000,  // ~6 months
  [DataTier.CountryStandard]: 182 * 24 * 60 * 60 * 1000, // ~6 months
  [DataTier.ExpertOverride]: null,                       // never auto-expire
};

/** Confidence band (BUILD_PLAN §3.1 gating). Numeric confidence is 0..1; bands gate behavior. */
export enum ConfidenceBand {
  High = 'high',     // >= 0.8 → serve as known
  Medium = 'medium', // 0.5..0.8 → serve, flag "verify"
  Low = 'low',       // < 0.5 → "low confidence / limited data" designed state (never fabricate)
}

export function bandOf(confidence: number): ConfidenceBand {
  if (confidence >= 0.8) return ConfidenceBand.High;
  if (confidence >= 0.5) return ConfidenceBand.Medium;
  return ConfidenceBand.Low;
}

/** Attached to every served reference value (§3.3). */
export interface Provenance {
  source: DataSource;
  sourceUrl: string | null;
  verifiedAt: string | null; // ISO-8601
  confidence: number;        // 0..1
  band: ConfidenceBand;
  citationVerified: boolean; // §3.4 — URL reachable + grounding check passed
}

/** Computed freshness for a served value (drives "last verified: <date>" UI + stale flag). */
export interface Freshness {
  dataTier: DataTier;
  verifiedAt: string | null;
  ageMs: number | null;
  isStale: boolean;          // ageMs > FRESHNESS_TTL_MS[tier] (null tier => never stale)
  ttlMs: number | null;
}

export function computeFreshness(tier: DataTier, verifiedAt: string | null, now = Date.now()): Freshness {
  const ttlMs = FRESHNESS_TTL_MS[tier];
  const ageMs = verifiedAt ? now - Date.parse(verifiedAt) : null;
  const isStale = ttlMs != null && ageMs != null ? ageMs > ttlMs : false;
  return { dataTier: tier, verifiedAt, ageMs, isStale, ttlMs };
}
```

---

# 5. Repo / project conventions

### 5.1 Directory layout (the new server — modular monolith, ADR-001)
```
/server
  index.ts                 # app entrypoint (replaces today's server.ts startServer)
  worker.ts                # pg-boss worker entrypoint (ADR-002): refresh, re-embed, prewarm, evals
  app.ts                   # express app assembly (middleware + routers), exported for tests
  /routes
    health.ts  trade.ts  analysis.ts  jobs.ts  classify.ts
    corrections.ts  byok.ts  billing.ts  account.ts
  /middleware
    auth.ts                # Firebase verify + provision + SET LOCAL app.user_id
    rbac.ts                # role/plan gate (server-truth)
    rateLimit.ts           # per-user + per-IP
    costBreaker.ts         # global cost circuit-breaker (BUILD_PLAN §9)
    validate.ts            # zod boundary validator
    errorHandler.ts        # maps thrown AppError -> ApiError envelope (§3.4)
  /db
    schema.ts              # §2 — canonical
    client.ts              # drizzle + pg pool (Supavisor pooler URL)
    rls.ts                 # withUserTx() helper (§5.5)
    /migrations            # drizzle-kit output (+ hand-written RLS policy SQL)
  /services
    /llm  gemini.ts models.ts     # GA model IDs (ADR-007); zero DB-write
    /rag  retrieve.ts rerank.ts embed.ts gate.ts citations.ts
    crypto.ts              # KMS envelope encrypt/decrypt (ADR-004)
    provenance.ts          # conflict resolution (§3.3), freshness (§4)
    trade/  wto.ts comtrade.ts    # authoritative-number proxies (per-user BYOK)
    stripe.ts
  /schemas                 # shared zod request/response + LLM-output schemas (ADR-011)
  /jobs                    # pg-boss job handlers
/shared
  provenance.ts            # §4 — imported by server AND src
  envelope.ts              # ApiSuccess/ApiError types
/src                       # existing React+Vite client (PWA in Phase 5)
drizzle.config.ts
```

### 5.2 Module boundaries (Fowler — extract a service only when proven)
Everything is ONE deployable + ONE Postgres. The `worker.ts` process is the same codebase, different entrypoint.
No microservices until a real boundary proves itself (architect anti-pattern: distributed monolith).

### 5.3 Env var names (loaded from GCP Secret Manager → process.env; `server.ts` keeps `import 'dotenv/config'` first)
```
# Datastore
DATABASE_URL                # Supabase pooled connection (Supavisor), service role
DATABASE_DIRECT_URL         # direct (non-pooled) — for drizzle-kit migrations only
# Auth
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY
# LLM (server-side only — NEVER in the client bundle; ADR-007/013)
GEMINI_API_KEY
# Trade APIs (platform defaults; per-user BYOK overrides via user_api_keys)
WTO_API_KEY
UN_COMTRADE_API_KEY
# KMS / crypto (ADR-004)
GCP_KMS_KEY_NAME            # projects/*/locations/*/keyRings/*/cryptoKeys/*
# Billing
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
# Ops
NODE_ENV
PORT                        # default 3000 (unchanged)
COST_BREAKER_USD_PER_MIN    # global circuit-breaker threshold (BUILD_PLAN §9)
```
**Removed:** the Vite `define` injection of `GEMINI_API_KEY`/`GOOGLE_MAPS_PLATFORM_KEY` (Phase 0) — no secret in
the built bundle.

### 5.4 Migration tooling: **drizzle-kit**
- `drizzle.config.ts` points at `server/db/schema.ts`, dialect `postgresql`, out `server/db/migrations`,
  uses `DATABASE_DIRECT_URL`.
- Workflow: edit `schema.ts` → `drizzle-kit generate` → review SQL → hand-append RLS policy SQL for new tenant
  tables → `drizzle-kit migrate` (or apply via CI). Never edit committed migration SQL after it ships.
- Extensions enabled in the first migration: `CREATE EXTENSION IF NOT EXISTS vector;` and `pg_cron` (if used by
  refresh jobs).

### 5.5 Per-request RLS wiring — `withUserTx()`
```typescript
// server/db/rls.ts — every authenticated DB access goes through this
export async function withUserTx<T>(
  auth: { userId: string; role: string },
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL app.user_id = ${auth.userId}`);
    await tx.execute(sql`SET LOCAL app.role = ${auth.role}`);
    return fn(tx);
  });
}
```
RLS policies read `current_setting('app.user_id', true)` / `app.role`. The API DB user is NOT a superuser and
does NOT `BYPASSRLS` (defense-in-depth, BUILD_PLAN §7).

### 5.6 Strangler-Fig dual-write wiring (BUILD_PLAN §10)
A feature flag `MIGRATION_PHASE` (env, values `1`..`5` matching §10 steps) drives a thin `CacheRepository`
seam in `server/services/cache.ts`:
1. **Step 1 (stand up):** Postgres+pgvector live alongside Firestore; reads still Firestore.
2. **Step 2 (dual-write):** `CacheRepository.write()` writes BOTH Firestore (existing `trade_laws`,
   `trade_pulses` collections used by `gemini.ts`) AND Postgres `hs_code_data` (with provenance). Failures to the
   *new* store are logged, not fatal (reversible).
3. **Step 3 (backfill):** a one-off pg-boss job reads `trade_laws`/`trade_pulses` → upserts `hs_code_data`
   (source=`grounded_llm`, confidence backfilled, `verified_at` = original timestamp) + enqueues embeds.
4. **Step 4 (flip reads):** `CacheRepository.read()` reads Postgres behind the flag; Firestore becomes the
   fallback only.
5. **Step 5 (retire):** drop the Firestore branch + the dual-write; **keep Firebase Auth** (§ADR-006). Legacy
   `/api/trade/*` aliases removed; `firestore.rules` cache collections decommissioned.
Each step is independently shippable and reversible (flag flip back).

---

# 6. Spec index (cross-link target for all phases)

| # | Spec file | Owning skill(s) | Exit metric (BUILD_PLAN §12) |
|---|---|---|---|
| 0 | `phase-0-de-risk.md` | `security-engineer` + `backend-engineer` (+ `devops-engineer`) | No secret in built bundle; all AI calls server-side; auth enforced |
| 1 | `phase-1-data-rag-accuracy.md` | `ai-rag-engineer` + `data-engineer` (+ `trade-customs-expert` golden set) | Golden-set match ≥90%; citation-coverage 100%; cache-hit ≥40% |
| 2 | `phase-2-smooth-ux.md` | `frontend-engineer` (+ `backend-engineer` for SSE/queue, `ui-ux-designer`) | First useful content <3s; deep p95 <30s; LCP<2.5s |
| 3 | `phase-3-byok.md` | `backend-engineer` + `security-engineer` (skill `wto-byok-onboarding`) | A user connects a real WTO key end-to-end; key never client-side |
| 4 | `phase-4-billing-compliance.md` | `payments-billing-engineer` + `growth-pricing` + `legal-compliance-privacy` | Paid upgrade works; disclaimers + privacy policy live |
| 5 | `phase-5-offline-polish.md` | `frontend-engineer` + `product-manager` (+ `trade-customs-expert` correction queue) | Works offline for cached data; human-in-loop corrections loop live |
| 6 | `phase-6-harden-scale.md` | `security-engineer` + `qa-tester` + `devops-engineer` | Pen-test passed; SLO dashboards green; cache-hit ≥60% |

> **Sequencing (BUILD_PLAN §12):** Phase 0 blocks all. Accuracy (1) precedes smoothness (2) precedes
> monetization (4). Every phase passes the `security-engineer` + `qa-tester` gates; no domain output is
> "accurate" until `trade-customs-expert` validates it. `delivery-orchestrator` sequences the personas.
> Each phase spec MUST link back to this foundation for: the schema (§2), the API envelopes/error codes (§3),
> the provenance/freshness types (§4), and the ADR it depends on.

---

## Sources (for the deferred GA-model decisions in ADR-005/007/008/009)
- Gemini 2.5 Flash/Pro GA: <https://cloud.google.com/blog/products/ai-machine-learning/gemini-2-5-flash-lite-flash-pro-ga-vertex-ai>
- Gemini models list: <https://ai.google.dev/gemini-api/docs/models>
- `gemini-embedding-001` (3072 default, MRL → 1536/768): <https://ai.google.dev/gemini-api/docs/models/gemini-embedding-001>
- Gemini embeddings (dimensions guidance): <https://ai.google.dev/gemini-api/docs/embeddings>
