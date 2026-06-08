# Trade-for-All — SaaS Build Plan

> Master plan. Shared by Codex, Gemini, and Claude Code. Read alongside `.ai/MEMORY.md`.
> Status: DRAFT v1 (2026-06-08). Update as phases complete.

## 0. North Star
An **enterprise-grade, lightweight, offline-capable** trade-intelligence SaaS for SME exporters.
Monthly subscriptions. **Verifiable accuracy** (sourced + measured), not "magic 100%".
Fast first paint, works degraded offline, cheap to run via aggressive caching + RAG.

### Hard principles (non-negotiable)
1. **No secrets in the browser.** All LLM + third-party API calls happen server-side.
2. **No direct client writes** to DB or cache. Every write goes through a validated API.
3. **Deterministic facts ≠ LLM output.** Hard numbers (duty/tax) come from authoritative APIs; the
   LLM only *synthesizes over retrieved, cited data*.
4. **Tenant isolation always.** Every query scoped by `user_id`; private data never crosses tenants.
5. **Measure what you claim.** Accuracy and performance have eval harnesses, not vibes.

---

## 1. Architecture

```
Browser (React PWA, no keys)
  │  Firebase ID token on every call
  ▼
API layer (server.ts → Express/Fastify)   ← all secrets live here
  • auth middleware (verify ID token)       • Stripe webhooks
  • RBAC + plan/quota gate (server-truth)   • RAG retrieve + LLM synthesize (cited)
  • input validation (zod)                  • WTO/Comtrade proxy w/ per-user BYOK keys
  • rate limiting                           • write-back to shared cache
  ▼            ▼              ▼            ▼
Postgres+pgvector   Gemini      Stripe     KMS / Secrets Mgr
(relational+vector) (server)   (billing)  (encrypts user keys)

Browser-local: Service Worker + IndexedDB (offline read cache: user data + last-known reference)
```

**Stack:** React + Vite (evolve to PWA, code-split, lazy routes) · Express/Fastify + TypeScript ·
Postgres + `pgvector` (ONE db = lightweight) · Drizzle ORM (parameterized) · Stripe · Firebase Auth ·
KMS-backed envelope encryption · optional Redis for hot rows.

---

## 2. Data model (Postgres)
- `users` — profile, plan, role (mirrors Firebase uid).
- `user_products` — per-user classification history: `user_id`, `query`, `hs_code`, clarifying Q&A
  (jsonb), `created_at`. Powers "same product again → instant".
- `countries` — per-country reference: laws, guidelines, taxes, `updated_at`.
- `hs_codes` — canonical HS entries.
- `hs_code_data` — product-level data BY HS code (all trade info), soft-versioned with `updated_at`.
  Two rows for same HS → **query latest by `updated_at`**. Refresh job every **6 months**.
- `embeddings` — pgvector column + FK to source row + `updated_at`. **Incremental re-embed**: only
  rows whose `updated_at` changed. Two corpora: SHARED reference (safe) vs PRIVATE per-user (never
  mixed into others' retrieval).
- `user_api_keys` — encrypted BYOK tokens (WTO now, Comtrade later). Ciphertext only; `provider`,
  `user_id`, `last_validated_at`, `status`.
- `subscriptions` — Stripe state. `usage` — per-user per-month counters (analyses, chat msgs).

---

## 3. RAG + accuracy (verifiable, sourced, measured)
**Flow:**
```
classify → look up hs_code_data cache (HS + clarifiers)
  hit & fresh  → serve from Postgres (≈0 cost, instant)
  miss/stale   → hybrid retrieve (keyword + vector) over SHARED corpus
              → LLM synthesizes ONLY over retrieved rows, MUST cite source_url per claim
              → validate output vs schema → write-back to cache (updated_at) + incremental embed
Hard numbers (duty/tax) → authoritative API (WTO/Comtrade), never invented by the LLM.
```
**Accuracy harness (from day 1):** golden set of HS-codes/routes with known-correct values; CI
metrics = numeric-match rate, citation coverage, confidence calibration. Ship confidence scores +
source URLs in the UI. **Kill the fabricated-data fallback** (`gemini.ts:216-226`).

---

## 4. Offline-first (read-only cache, v1)
- PWA: service worker caches the app shell → instant repeat loads, works offline.
- IndexedDB (Dexie): mirror the user's own data (saved products, past analyses) + last-known
  reference results. Offline = serve from IndexedDB with a "showing cached data" banner.
- Sync policy: server wins on reference data; user data last-write-wins per device. No live RAG
  offline (RAG is server-side) — offline shows last-known answers only.

---

## 5. WTO BYOK onboarding (per-user API key)
Verified flow (Azure APIM portal — matches `Ocp-Apim-Subscription-Key` already in `server.ts`):
1. Sign up → https://apiportal.wto.org/signup  2. Confirm email  3. Sign in
4. Products → **WTO Timeseries API** → Subscribe  5. Profile → reveal **Primary key** → copy
6. Paste into our app → **server validates** with a test call → **envelope-encrypt + store** at user level.
- In-app: guided checklist + deep links (NOT an iframe — WTO sets X-Frame-Options; can't be embedded).
- Status chip: 🟢 "WTO connected — verified live data" / ⚪ "demo data — add your key".
- Benefit: per-user 10/sec quota (no global throttle) + trust. Shared cache still legal (tariffs are
  public facts) — verify WTO ToS permits caching. See skill `wto-byok-onboarding`.

---

## 6. Security — defense-in-depth (goal: secure vs all KNOWN attack classes, minimal blast radius)
> Honest framing: not "literally unhackable" — that doesn't exist. We harden every layer so a single
> failure never exposes data or keys.

| Layer | Controls |
|---|---|
| **Secrets** | No keys in client bundle (fix `vite.config.ts` Gemini leak). User keys envelope-encrypted via KMS; decrypted in-memory only; never returned to browser. Rotation + least-privilege IAM. |
| **AuthN/Z** | Verify Firebase ID token server-side every request. RBAC via custom claims. Server-authoritative checks — never trust the client for plan/quota/ownership. |
| **Data access** | NO direct client DB/cache writes. All writes via validated API. Postgres Row-Level Security scoped by `user_id`. Service accounts least-privilege. |
| **SQL injection** | Parameterized queries / ORM only (Drizzle). Never string-concat SQL, including pgvector queries. |
| **Prompt injection** | Treat retrieved + user text as DATA, not instructions. Structured prompts, system vs content separation, sanitized RAG chunks, output schema validation, tool allow-list. **LLM has zero DB write access** — it returns structured output, the server validates + writes. |
| **XSS** | React escaping; configure `react-markdown` safely (no raw HTML from untrusted text); no `dangerouslySetInnerHTML` on user/LLM content. |
| **CSRF** | Token-based auth + SameSite cookies. |
| **Transport** | HTTPS/HSTS everywhere; strict security headers + CSP; our app sets X-Frame-Options to stop clickjacking. |
| **Abuse/DoS** | Per-user + per-IP rate limits; quota gate (also cost control); WAF/BotID; platform DDoS protection. |
| **Input** | Validate every API input with zod; reject malformed; size limits. |
| **Supply chain** | Fix the current 28 npm vulns; lockfile + Dependabot + SCA scanning in CI. |
| **Observability** | Audit logs, anomaly alerts, incident runbook. |
| **Pre-launch** | SAST + DAST + dependency scan in CI; third-party pen-test before charging. |

See skill `security-engineer` for the enforceable checklist.

---

## 7. Monetization (recap from shared brain)
Meter on **deep analyses** (where cost+value concentrate), not logins. Free / Starter / Growth /
Business tiers with quotas + overage on Business. Stripe Checkout + Customer Portal + webhooks →
custom claims. Shared HS-keyed cache is the margin lever (COGS scales with unique HS codes, not users).

---

## 8. The "commission" — expert personas (shared skills, model-agnostic)
Markdown skills in `.ai/skills/`, usable from Codex / Gemini / Claude:
`architect` · `ui-ux-designer` · `frontend-engineer` · `backend-engineer` · `devops-engineer` ·
`qa-tester` · `security-engineer`. Each = sharp role + operating principles + Definition-of-Done
checklist + anti-patterns. They share `.ai/memory` and the graphify map for consistency.

---

## 9. Phased roadmap
| Phase | Outcome | Highlights |
|---|---|---|
| **0. De-risk** | Safe to be public | Move AI server-side; remove key from bundle; auth middleware; fix npm vulns |
| **1. Data + RAG** | Cheap & grounded | Postgres+pgvector; data model; shared HS cache; RAG w/ citations; accuracy harness |
| **2. BYOK** | Trust + no throttle | WTO BYOK onboarding; encrypted keys; validation; status chip |
| **3. Billing** | Revenue | Stripe + quota gate + plan UI |
| **4. Offline + polish** | Enterprise feel | PWA + IndexedDB read cache; code-split; usage dashboard |
| **5. Harden + scale** | Sellable to business | GA models; security audit/pen-test; observability; team seats |

Each phase is shippable. Phase 0 is first and blocks the rest.
