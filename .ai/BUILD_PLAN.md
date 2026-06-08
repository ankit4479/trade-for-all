# Trade-for-All — SaaS Build Plan (v2)

> Master plan. Shared by Codex, Gemini, and Claude Code. Read alongside `.ai/MEMORY.md`.
> Status: v2 (2026-06-08) — adds accuracy-operations + perceived-performance layers, per-phase exit
> metrics, migration path, cost controls. Reviewed via `architect` + `ai-rag-engineer` + `trade-customs-expert`.

## 0. North Star
An **enterprise-grade, lightweight, offline-capable** trade-intelligence SaaS for SME exporters.
Monthly subscriptions. **Verifiable accuracy** (sourced + measured), not "magic 100%". The product must
*feel* instant even though analysis is heavy, and every number must be **current, sourced, and confidence-rated.**

### Hard principles (non-negotiable)
1. **No secrets in the browser.** All LLM + third-party API calls happen server-side.
2. **No direct client writes** to DB/cache. Every write goes through a validated API.
3. **Deterministic facts ≠ LLM output.** Hard numbers (duty/tax) come from authoritative APIs; the LLM
   only *synthesizes over retrieved, cited data*.
4. **Tenant isolation always.** Every query scoped by `user_id`; private data never crosses tenants.
5. **Measure what you claim.** Accuracy and performance have eval harnesses + dashboards, not vibes.
6. **Never blank, never guessed.** Unknown data is a *designed state*, not an error or a fabrication.
7. **Stream, don't stall.** Long operations render progressively; the UI never freezes on a spinner.

### Top-level success metrics (the scoreboard)
- **Accuracy:** golden-set numeric-match ≥ 95%; citation-coverage 100% of factual claims; citation-validity ≥ 98%.
- **Smoothness:** first paint < 1.5s; first *useful* analysis content streamed < 3s; full deep analysis p95 < 30s.
- **Cost/margin:** shared-cache hit-rate ≥ 60% (target 80%); COGS/analysis trending down as routes saturate.
- **Trust:** % of results with a visible source + freshness stamp = 100%.

---

## 1. Architecture
```
Browser (React PWA, no keys)
  │  Firebase ID token every call;  SSE/WebSocket for streamed analysis
  ▼
API layer (server.ts → Express/Fastify)            ← all secrets live here
  • auth middleware (verify ID token)               • Stripe webhooks (idempotent)
  • RBAC + plan/quota gate (server-truth)           • cost circuit-breaker
  • input validation (zod)                          • WTO/Comtrade proxy w/ per-user BYOK keys
  • rate limiting                                    • streaming synthesis (SSE)
  ▼            ▼            ▼          ▼            ▼
Postgres+pgvector  Job queue   Gemini   Stripe   KMS/Secrets
(relational+vector) (async,    (server) (billing) (encrypts
 + corrections      long ops)                       user keys)
 + provenance
        ▲ background workers: 6-tier refresh, incremental re-embed, cache pre-warm, eval runs
Browser-local: Service Worker + IndexedDB (offline read cache: user data + last-known reference)
```
**Stack:** React + Vite (→ PWA, code-split, lazy routes) · Express/Fastify + TS · Postgres + `pgvector`
(ONE db) · Drizzle ORM (parameterized) · a lightweight **job queue** (pg-boss on the same Postgres, or
Redis/BullMQ if a hot path proves it) · Stripe · Firebase Auth · KMS envelope encryption.
*Architect note:* job queue on Postgres (pg-boss) keeps us to ONE datastore — add Redis only when measured.

---

## 2. Data model (Postgres)
- `users` — profile, plan, role (mirrors Firebase uid; provisioned on first login).
- `user_products` — per-user classification history: `user_id`, `query`, `hs_code`, clarifying Q&A
  (jsonb), `created_at`. Powers "same product again → instant."
- `countries` — per-country reference: laws, guidelines, taxes, `updated_at`, `data_tier`.
- `hs_codes` — canonical HS entries.
- `hs_code_data` — product-level data BY HS code, **soft-versioned** (`updated_at`); query latest.
  Each field carries **provenance**: `source` (wto|comtrade|grounded_llm|expert_override), `source_url`,
  `verified_at`, `confidence`, `data_tier` (see §3 freshness tiers).
- `data_corrections` — **human-in-the-loop overrides**: `hs_code`/route, field, corrected_value, `source`
  (`expert`|`user_flag`), `reviewer`, `status` (pending|approved|rejected), `created_at`. Approved
  corrections **win over** cache + LLM. This is how accuracy compounds.
- `embeddings` — pgvector + FK to source row + `updated_at`. **Incremental re-embed** (only changed rows).
  Two corpora: SHARED reference (safe) vs PRIVATE per-user (never mixed into others' retrieval).
- `user_api_keys` — encrypted BYOK tokens. Ciphertext only; `provider`, `user_id`, `last_validated_at`, `status`.
- `subscriptions` — Stripe state. `usage` — per-user per-month counters. `analysis_jobs` — async job
  state (queued|running|streaming|done|failed, partial results). `events` — product analytics (cache-hit, COGS, funnel).

---

## 3. Accuracy operations (the core upgrade — verifiable, sourced, measured, *current*)

### 3.1 Retrieval + synthesis flow (with confidence gating)
```
classify → resolve corrections override?  yes → serve approved override (highest trust)
         → look up hs_code_data cache (HS + clarifiers + freshness check, §3.2)
  fresh hit  → serve from Postgres (≈0 cost, instant)
  miss/stale → hybrid retrieve (keyword + vector) over SHARED corpus → RERANK
             → retrieval-confidence gate:
                  strong → LLM synthesizes ONLY over retrieved rows, structured output, cite per claim
                  weak   → return "low confidence / limited data" state (NEVER fabricate)
             → validate output schema → validate citations (§3.4) → resolve source conflicts (§3.3)
             → write-back to cache w/ provenance + confidence → incremental embed
Hard numbers (duty/tax) → authoritative API (WTO/Comtrade), never invented by the LLM.
```

### 3.2 Tiered freshness (replaces flat "6 months")
| Data type | TTL | On expiry |
|---|---|---|
| Trade pulse / news / sanctions | 1–24 h | background revalidate; flag if older |
| Duty/tariff rates, FTA terms | ~12 months (annual schedules) | revalidate; show "verify" if stale |
| HS classification, country standards | ~6 months | revalidate |
| Expert overrides (`data_corrections`) | until superseded | never auto-expire |
Every served value shows **"last verified: <date>"**; stale-but-served is labeled, never silently passed as current.

### 3.3 Source-conflict resolution
Precedence: **expert override > WTO authoritative > Comtrade-derived > grounded-LLM**. If sources disagree
beyond tolerance → serve highest-precedence value + a **"sources disagree"** confidence flag with both shown.
If no source → **"data unavailable for this route"** (a designed state, §0 principle 6).

### 3.4 Citation verification (cited ≠ true)
For each factual claim: (1) URL reachable, (2) lightweight grounding check that the source plausibly
supports the claim. Unverifiable citation → downgrade confidence + label "unverified source."

### 3.5 Eval harness + ownership + model-drift gate
- **Owner:** `trade-customs-expert` curates the golden set (HS/route → known-correct duty/tax/classification),
  ≥150 cases at launch, updated each refresh cycle.
- **CI metrics:** numeric-match rate, citation coverage + validity, retrieval relevance, confidence calibration
  (LLM-as-judge **calibrated vs human labels** per `ai-rag-engineer`). Regressions block merge.
- **Model-drift gate:** any model/prompt change re-runs the golden set before rollout. Pin GA models (no `*-preview`).

### 3.6 Human-in-the-loop correction loop
User "flag as wrong" + expert review queue → approved correction lands in `data_corrections` → overrides
cache/LLM for everyone → added to the golden set. Accuracy *compounds* instead of plateauing.
**Kill the fabricated-data fallback** (`gemini.ts:216-226`).

---

## 4. Smooth experience / perceived performance
1. **Stream the analysis.** Deep analysis fires 15–30+ LLM calls; render each market/section via SSE as it
   lands (skeleton → fill). First useful content < 3s even if the full run takes 30s.
2. **Async job queue for long ops.** Multi-market analysis runs as a background `analysis_job`; the UI
   subscribes (SSE/WebSocket) and survives navigation/timeouts. Status: queued→running→streaming→done.
3. **Cache pre-warming.** Background worker pre-computes top-N popular HS routes so the *first* user isn't
   slow and cache-hit-rate climbs toward the 80% margin target.
4. **Optimistic + cached-first UI.** Render last-known (IndexedDB) instantly, revalidate in background.
5. **Latency budgets enforced in CI** (Osmani/`frontend-engineer`): JS ≤170KB initial; LCP<2.5s, INP<200ms.
6. **Graceful degradation.** On retry-exhaustion or circuit-breaker trip → serve cached/partial + clear
   "showing cached / try again" state, never a dead spinner.

---

## 5. Offline-first (read-only cache, v1)
PWA service worker caches the app shell (instant repeat loads, works offline). IndexedDB (Dexie) mirrors
the user's own data + last-known reference results; offline serves these with a "showing cached data"
banner. Sync: server wins on reference; user data last-write-wins per device. No live RAG offline.

---

## 6. WTO BYOK onboarding (per-user API key)
Azure-APIM flow (matches `Ocp-Apim-Subscription-Key` in `server.ts`): signup → confirm → subscribe to
**WTO Timeseries API** → copy **Primary key** → paste → **server validates (test call) → envelope-encrypt
+ store**. In-app guided checklist + deep links (no iframe — X-Frame-Options). Status chip 🟢/⚪.
Per-user 10/sec quota (no global throttle) + trust. Shared cache of public tariff facts still applies —
verify WTO ToS (`legal-compliance-privacy`). See skill `wto-byok-onboarding`.

---

## 7. Security — defense-in-depth (secure vs all KNOWN attack classes; minimal blast radius)
> Honest framing: not "literally unhackable." Harden every layer so one failure never exposes data/keys.

Secrets (no client-bundle keys; KMS envelope-encrypted BYOK, never to browser) · AuthN/Z (server-verified
Firebase token, RBAC claims, no client-trusted authz) · Data access (no direct client writes; Postgres RLS
by `user_id`) · **SQL injection** (parameterized/Drizzle only, incl. pgvector) · **Prompt injection**
(retrieved/user text = data not instructions; schema-validated output; LLM has **zero DB write**; sanitize
RAG chunks — OWASP **LLM01/LLM08**) · XSS (safe markdown, no raw HTML) · CSRF (token + SameSite) · Transport
(HTTPS/HSTS, CSP, X-Frame-Options) · Abuse/DoS (per-user+IP rate limits, WAF/BotID, DDoS) · Input (zod) ·
Supply chain (fix 28 npm vulns; Dependabot + SCA) · Observability (audit logs, alerts) · Pre-launch
(SAST/DAST + pen-test before charging). Full standard incl. **OWASP LLM Top 10 (2025)** in `security-engineer`.

---

## 8. Monetization
Meter on **deep analyses** (cost+value concentrate there), not logins — usage/credit-based, the current
AI-SaaS norm (`growth-pricing`). Free / Starter / Growth / Business tiers + overage on Business. Stripe
Checkout + Customer Portal + idempotent webhooks → Firebase custom claims (replaces hardcoded admin email).
Shared HS-keyed cache is the margin lever (COGS scales with unique routes, not users). Flexible billing
infra so pricing can iterate often (Verna).

---

## 9. Cost controls
Per-user + **global cost circuit-breaker**: when spend/min exceeds threshold (cache-miss storm or abuse),
degrade to cached/queued instead of unbounded Gemini calls. Quota gate doubles as cost control. Budget
alerts + COGS/request dashboard (`devops-engineer`). Cache-hit-rate is a tracked SLO.

---

## 10. Migration path (current Firestore → Postgres)
Strangler-Fig, no big-bang: (1) stand up Postgres+pgvector alongside Firestore; (2) **dual-write** new
cache entries to both; (3) backfill existing `trade_laws`/`trade_pulses` into `hs_code_data` with
provenance; (4) flip reads to Postgres behind a flag; (5) retire Firestore caching (keep Firebase Auth).
Each step reversible.

---

## 11. The commission — 16 expert personas (shared skills, model-agnostic)
In `.ai/skills/`, usable from Codex/Gemini/Claude. **`delivery-orchestrator`** sequences them; nothing
ships without the **`security-engineer`** + **`qa-tester`** gates, and no domain output is "accurate"
until **`trade-customs-expert`** validates it.
- Product/domain: `product-manager` · `trade-customs-expert` · `growth-pricing` · `delivery-orchestrator`
- Design/eng: `architect` · `ui-ux-designer` · `frontend-engineer` · `backend-engineer` · `ai-rag-engineer` · `data-engineer` · `payments-billing-engineer`
- Quality/ops/trust: `security-engineer` · `qa-tester` · `devops-engineer` · `legal-compliance-privacy` · `technical-writer`
Each = named-expert ideology + operating principles + Definition-of-Done + anti-patterns. See `.ai/skills/README.md`.

---

## 12. Phased roadmap (each phase has an EXIT METRIC; QA + security gates every phase)
| Phase | Outcome | Highlights | Exit metric |
|---|---|---|---|
| **0. De-risk** | Safe to be public | AI server-side; remove bundle key; auth middleware; fix high/critical npm vulns | No secret in built bundle; all AI calls server-side; auth enforced |
| **1. Data + RAG + accuracy** | Cheap, grounded, correct | Postgres+pgvector; data model + provenance + corrections table; shared cache; retrieval+rerank+gating; tiered freshness; citation verification; **eval harness + golden set**; analytics (cache-hit) instrumented; Strangler migration steps 1–3 | Golden-set match ≥90%; citation-coverage 100%; cache-hit ≥40% |
| **2. Smooth UX** | Feels instant | Streaming (SSE) + async job queue; cache pre-warm; optimistic/cached-first UI; latency budgets | First useful content <3s; deep p95 <30s; LCP<2.5s |
| **3. BYOK** | Trust + no throttle | WTO BYOK onboarding; encrypted keys; validation; status chip | A user connects a real key end-to-end; key never client-side |
| **4. Billing + compliance** | Revenue, legally clean | Stripe + quota gate + plan UI; **legal pass** (GDPR, disclaimers, WTO-caching ToS) | Paid upgrade works; disclaimers + privacy policy live |
| **5. Offline + polish** | Enterprise feel | PWA + IndexedDB read cache; usage dashboard; human-in-loop correction UI + expert queue | Works offline for cached data; corrections loop live |
| **6. Harden + scale** | Sellable to business | GA models; security audit/pen-test; full observability; team seats; cost circuit-breaker | Pen-test passed; SLO dashboards green; cache-hit ≥60% |

Each phase is shippable. Phase 0 is first and blocks the rest. Accuracy (Phase 1) precedes smoothness
(Phase 2) precedes monetization (Phase 4) — never charge for fast-but-wrong data.
