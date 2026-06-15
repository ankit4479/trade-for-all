# Phase 0 — De-risk (make the app safe to be public)

> **Owning skills:** `security-engineer` (lead) + `backend-engineer` + `devops-engineer`.
> **Status:** v1 (2026-06-09). Authored against `.ai/specs/00-foundation.md` (the SINGLE SOURCE OF
> TRUTH — referenced, never re-decided here) and `.ai/BUILD_PLAN.md` (§0 principles, §7 security, §12
> Phase 0 row).
> **Spec index id:** Phase 0 — "Safe to be public" (foundation §6 / BUILD_PLAN §12).
>
> This spec is **buildable**: the endpoint contracts, middleware, client, and config below are real
> TypeScript / config an engineer can implement directly. It does **not** redefine the schema (foundation
> §2), the envelopes/error codes (foundation §3), or the provenance types (foundation §4) — it **imports**
> them. Where this spec needs a foundation decision it cites the ADR.

---

## 0. Goal + exit metric

**Goal (BUILD_PLAN §12, row 0):** the app is *safe to be public*. Today it is not — the Gemini API key
is compiled into the browser bundle (`vite.config.ts` `define`), every AI call runs in the browser with
that key, authorization is a hardcoded email string, one function fabricates duty/tax numbers, the LLM
calls forbidden `*-preview` models, and there are 28 npm vulns (1 critical, 8 high).

**Exit metric (the gate — all three must be provably true):**

1. **No secret in the built bundle.** `grep` of `dist/**` (and the source map) finds **zero** API keys.
   (Verification W2.4 / §11.)
2. **All AI calls happen server-side.** `src/services/gemini.ts` no longer imports `@google/genai` and
   no longer references `process.env.GEMINI_API_KEY`. The browser only calls `/api/v1/*`. (Verification §11.)
3. **Auth enforced.** Every `/api/v1/*` route (except `/health`) returns `401 UNAUTHENTICATED` without a
   valid Firebase ID token; authorization is a server-verified **custom claim**, not a hardcoded email.
   (Verification §11.)

A secondary, non-blocking-but-required outcome: the **1 critical + 8 high** npm vulns are remediated
(Workstream 6); `npm audit` shows 0 critical / 0 high. (BUILD_PLAN §7 supply-chain line.)

These map 1:1 to the three BUILD_PLAN §0 hard principles Phase 0 enforces: **#1 no secrets in the
browser**, **#3 deterministic facts ≠ LLM output** (kills the fabricated fallback + preview models),
and the AuthN/Z layer of **§7**.

---

## 1. Scope / non-goals

### In scope (Phase 0 does)
- **W1** — Move **every** Gemini call out of the browser into a server proxy under `/api/v1/ai/*`.
  Introduce a thin browser client that calls those endpoints. Stand up the server service module that
  is the *only* place `new GoogleGenAI` exists.
- **W2** — Delete the `define`-injected Gemini/Maps keys from `vite.config.ts`; move the key to server env;
  verify the bundle is clean.
- **W3** — `firebase-admin` ID-token verification middleware applied to all `/api/v1/*` routes; attach
  `req.auth`; replace the hardcoded admin email (`amankr4883@gmail.com`) in `firestore.rules` **and**
  `gemini.ts`-derived logic with a Firebase **custom claim** (`role: 'admin'`); ship a one-shot claim-set script.
- **W4** — Delete the fabricated duty/tax fallback (`gemini.ts:216–226`); replace with the foundation's
  **`{ state: 'unavailable' }`** designed-unknown shape (foundation §3.5).
- **W5** — Pin **GA** models per **ADR-007**: every `gemini-3-flash-preview` → `gemini-2.5-flash`, every
  `gemini-3.1-pro-preview` → `gemini-2.5-pro`. Centralize the IDs in `server/services/llm/models.ts`.
- **W6** — Remediate the 1 critical + 8 high npm vulns.

### Explicitly deferred to later phases (NON-GOALS for Phase 0)
- **Postgres / pgvector / Drizzle / RLS / migrations** → **Phase 1** (foundation §2, §5.5). Phase 0 keeps
  the existing Firestore cache exactly as-is; the new AI endpoints write to Firestore **server-side** using
  the same collection shapes the client used (no schema change, no Strangler dual-write yet).
- **RAG retrieve / rerank / embeddings / citation verification / eval harness / golden set** → **Phase 1**.
  Phase 0 does **not** improve accuracy; it *removes fabrication* and *moves calls server-side*. The
  prompts/schemas are ported verbatim (a behavior-preserving move, except the killed fallback).
- **KMS envelope encryption + BYOK** (ADR-004, §3 BYOK) → **Phase 3**. Phase 0 uses a single platform
  `GEMINI_API_KEY` from env; no per-user keys.
- **Stripe / billing / quota gate / custom-claim-on-plan-change** → **Phase 4**. Phase 0 only sets the
  **admin** claim via a manual script (the *mechanism* billing will later reuse).
- **`users` table provisioning on first login, `withUserTx`/`SET LOCAL app.user_id`** → **Phase 1** (no
  Postgres yet). Phase 0's middleware attaches `req.auth` from the verified token only.
- **SSE streaming + async job queue (pg-boss)** → **Phase 2** (ADR-010/002). Phase 0 endpoints are plain
  request/response JSON, preserving today's blocking behavior.
- **Rate limiting / cost circuit-breaker / WAF / full observability** → primarily **Phase 6**; Phase 0
  adds only a *minimal* per-IP rate limit on the AI routes as a cheap abuse guard (cheap, reversible).
- **Express 5 upgrade** (ADR-001): Phase 0 upgrades Express within the 4.x line for the security fix
  (W6) and structures routes; the major bump to Express 5 is folded into Phase 1's `server/` build-out.
- The full `server/` modular-monolith directory layout (foundation §5.1) is **introduced incrementally**:
  Phase 0 adds the minimum (`server/middleware/auth.ts`, `server/services/llm/`, `server/routes/ai.ts`,
  `server/http/envelope.ts`) and keeps the rest of `server.ts` intact. Phase 1 completes the layout.

---

## 2. Workstream 1 — Move all Gemini calls server-side

**Why (BUILD_PLAN §0 #1 / §7 secrets):** the browser must hold zero keys. Today `src/services/gemini.ts:57`
does `new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })` *in the browser* — the key is the bundled
secret W2 removes. The fix is structural: the model client moves to the server; the browser calls our API.

### 2.1 Inventory — every model-calling function in `src/services/gemini.ts`

Grepping `ai.models.generateContent` and the exported entry points, there are **five** functions that
reach the model (two of them call it more than once):

| # | Function (current) | Model calls | Uses Google Search tool | Uses function-calling tool | Writes Firestore | Notes |
|---|---|---|---|---|---|---|
| 1 | `analyzeProduct(description, originCountry)` (552) | 1 (line 562) | no | no | no | High-level 3/2/2 market analysis. |
| 2 | `fetchMarketDetails(productName, hsCode, origin, destination)` (581) | 2 (586 tool-call + 627 synthesis) + internal `fetchRealTradeData` (185) | yes (185) | yes (586/589) | yes (`trade_laws`, 661) | Deep analysis. Calls `fetchRealTradeData` which hits our existing `/api/trade/comtrade` + `/api/trade/wto-tariff` proxies **and** the model. |
| 3 | `classifyProduct(description, answers?)` (685) | 1 (689) | no | no | no | HS classification + clarifying questions. |
| 4 | `fetchTradePulse(country)` (712) | 1 (733) | yes (745) | no | yes (`trade_pulses`, 781) reads cache (718) | Trade news/risk; 1h Firestore cache. |
| 5 | `askExpert(message, history, context)` (794) | 1 (817) | yes (822) | no | no | Chat; uses **pro** model. Returns free text (not JSON). |

Supporting (no separate endpoint; server-internal): `fetchRealTradeData` (126) — invoked **only** by
`fetchMarketDetails`'s tool call; it stays server-side as a private helper of the deep-analysis endpoint.
`withRetry` (62) and `safeJsonParse` (520) move to the server unchanged. `getTradeLawCacheId` (541) /
`getPulseCacheId` (547) move server-side (cache-key derivation). `handleFirestoreError` (34) is replaced by
server-side logging (it currently leaks `auth.currentUser` PII into thrown errors — do **not** port that).

### 2.2 Endpoint contracts (foundation §3 conventions)

All under **`/api/v1`** (foundation §3.1), all require `Authorization: Bearer <Firebase ID token>`
(foundation §3.2, W3), all responses use the **`ApiSuccess<T>` / `ApiError`** envelope (foundation §3.3/§3.4).
Bodies are zod-validated at the boundary (ADR-011). Phase 0 keeps these **synchronous** (Phase 2 converts the
two heavy ones to jobs+SSE). Each replaces exactly one client function:

#### E1 — `POST /api/v1/ai/analyze` → replaces `analyzeProduct`
```http
POST /api/v1/ai/analyze
Authorization: Bearer <idToken>
Content-Type: application/json

{ "description": "stainless steel water bottles, double-walled", "originCountry": "India" }
```
- **Request zod:** `{ description: string().min(2).max(2000), originCountry: string().min(2).max(64) }`
- **Success:** `200` `ApiSuccess<MarketAnalysis>` — `data` is exactly today's `analyzeProduct` shape
  (`initialAnalysisSchema`, gemini.ts:255). `meta.requestId` always present.
- **Errors:** `422 VALIDATION_FAILED` (bad body) · `401 UNAUTHENTICATED` · `429 RATE_LIMITED` (per-IP guard)
  · `502 UPSTREAM_UNAVAILABLE` (Gemini failed after retries) · `500 INTERNAL`.

#### E2 — `POST /api/v1/ai/market-details` → replaces `fetchMarketDetails`
```http
POST /api/v1/ai/market-details
{ "productName": "Water bottles", "hsCode": "961700", "origin": "India", "destination": "Germany" }
```
- **Request zod:** `{ productName: string().min(1).max(256), hsCode: string().regex(/^[0-9.]{4,12}$/),
  origin: string().min(2).max(64), destination: string().min(2).max(64) }`
- **Server behavior:** runs the existing two-step flow server-side — (1) model tool-call decides country
  codes → (2) `fetchRealTradeData` (now server-internal) hits `/api/trade/comtrade` + `/api/trade/wto-tariff`
  proxies **directly in-process** (no localhost round-trip — call the proxy handlers' logic as functions) →
  (3) synthesis model call. The **fabricated fallback is gone** (W4); a failed authoritative fetch yields
  `{ state: 'unavailable' }` for that destination's hard numbers, never invented digits.
- **Success:** `200` `ApiSuccess<MarketDetail>` where `MarketDetail` is today's `detailedInfoSchema`
  (gemini.ts:305) **plus** the metadata the client expects (`productName`, `hsCode`, `originCountry`,
  `destinationCountry`, `detailId`). Server performs the `trade_laws` Firestore write (formerly gemini.ts:661)
  using the **server-verified `req.auth.firebaseUid`** as `userId` — not a client-supplied id.
- **Errors:** as E1, plus the per-destination duty/tax block may carry the designed-unknown state (W4) inside
  a `200` body — *absence of data is not an HTTP error* (foundation §3.4 rule).

#### E3 — `POST /api/v1/ai/classify` → replaces `classifyProduct`
```http
POST /api/v1/ai/classify
{ "description": "electric motor", "answers": { "Output power?": "Over 750W" } }
```
- **Request zod:** `{ description: string().min(2).max(2000), answers: record(string(), string()).optional() }`
- **Success:** `200` `ApiSuccess<ClassificationResult>` (today's `classificationSchema`, gemini.ts:232).
- **Errors:** as E1.

#### E4 — `GET /api/v1/ai/trade-pulse?country=<name>` → replaces `fetchTradePulse`
```http
GET /api/v1/ai/trade-pulse?country=Germany
```
- **Request zod (query):** `{ country: string().min(2).max(64) }`
- **Server behavior:** reads/writes the existing `trade_pulses` Firestore doc **server-side** with the 1h TTL
  preserved; cache key from `getPulseCacheId(req.auth.firebaseUid, country)`. (This is a read-then-maybe-write;
  GET is acceptable because the write is an idempotent cache-fill, not a user-state mutation. Phase 1 moves
  this to `hs_code_data`/`trade_pulse` tier with provenance.)
- **Success:** `200` `ApiSuccess<TradePulse>` (today's pulse schema, gemini.ts:747).
- **Errors:** as E1.

#### E5 — `POST /api/v1/ai/ask-expert` → replaces `askExpert`
```http
POST /api/v1/ai/ask-expert
{
  "message": "Do I need CE marking for Germany?",
  "history": [{ "role": "user", "parts": [{ "text": "..." }] }],
  "context": { "productName": "Water bottles", "hsCode": "961700", "origin": "India", "destination": "Germany" }
}
```
- **Request zod:** `{ message: string().min(1).max(4000),
  history: array(object({ role: enum(['user','model']), parts: array(object({ text: string().max(8000) })) })).max(40),
  context: object({ productName: string(), hsCode: string(), origin: string(), destination: string() }) }`
- **Success:** `200` `ApiSuccess<{ reply: string }>` (free text; the only non-JSON-schema model call —
  uses `gemini-2.5-pro` per ADR-007/W5).
- **Errors:** as E1.

> **Prompt-injection note (LLM01, security-engineer skill):** `message`, `history`, and `context.*` are
> **user-controlled data, not instructions**. The system instruction stays server-side (foundation §3 /
> ADR-011); user text is only ever placed in `role:'user'` parts, never concatenated into the system
> instruction. Output of JSON endpoints is schema-validated (ADR-011) before return; a parse failure is a
> miss, never served as fact (foundation §3.5). The LLM has **zero DB-write capability** — the only writes
> are the server's own cache-fills (E2/E4) with server-derived keys.

### 2.3 Server service module — the only `new GoogleGenAI`

`server/services/llm/gemini.ts` is the sole holder of the client and the moved logic. The key comes from
`process.env.GEMINI_API_KEY` **on the server** (W2 removed the bundle path).

```typescript
// server/services/llm/gemini.ts  (server-only — NEVER imported by src/)
import { GoogleGenAI, Type, type FunctionDeclaration } from '@google/genai';
import { MODELS } from './models';            // W5 — GA model IDs
import { withRetry, safeJsonParse } from './util';

if (!process.env.GEMINI_API_KEY) {
  throw new Error('[fatal] GEMINI_API_KEY missing from server env'); // fail closed at boot
}
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// --- ported verbatim from src/services/gemini.ts (schemas + helpers), minus the client key path ---
// classificationSchema, initialAnalysisSchema, detailedInfoSchema, fetchTradeDataDeclaration → moved here.

export async function analyzeProduct(description: string, originCountry: string) {
  return withRetry(async () => {
    const prompt = `Analyze export viability ... (unchanged prompt body)`;
    const response = await ai.models.generateContent({
      model: MODELS.FLASH,                     // W5: was 'gemini-3-flash-preview'
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0.1,
        maxOutputTokens: 2048,
        systemInstruction: 'You are a Global Trade Intelligence Engine ...',
        responseMimeType: 'application/json',
        responseSchema: initialAnalysisSchema,
      },
    });
    const text = response.text || '';
    if (!text) throw new Error('Empty response from Gemini');
    return safeJsonParse(text);                // schema-validated downstream by the route's zod
  });
}

export async function classifyProduct(description: string, answers?: Record<string, string>) { /* MODELS.FLASH */ }
export async function fetchMarketDetails(productName: string, hsCode: string, origin: string, destination: string) { /* MODELS.FLASH; W4 fallback removed */ }
export async function fetchTradePulse(firebaseUid: string, country: string) { /* MODELS.FLASH */ }
export async function askExpert(message: string, history, context) {
  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: MODELS.PRO,                       // W5: was 'gemini-3.1-pro-preview'
      contents: history.concat([{ role: 'user', parts: [{ text: message }] }]),
      config: { systemInstruction, tools: [{ googleSearch: {} }] },
    });
    return response.text || "I'm sorry, I couldn't generate a response. Please try again.";
  });
}
```

Route layer (`server/routes/ai.ts`) wires the five endpoints, each: `validate(zodSchema)` →
`requireAuth` (W3, applied at the router level) → call the service → wrap in `ok(data, { requestId })` →
errors flow to `errorHandler` (foundation §3.4). Mounted in `server.ts` via `app.use('/api/v1/ai',
requireAuth, aiRouter)`.

### 2.4 New browser-side client — replaces `src/services/gemini.ts`

`src/services/gemini.ts` is **rewritten** to a thin fetch client. It no longer imports `@google/genai`,
no longer references `process.env.GEMINI_API_KEY`, and no longer writes Firestore directly (writes move
server-side per BUILD_PLAN §0 #2). It attaches the Firebase ID token to every call.

```typescript
// src/services/gemini.ts  (NEW — browser; zero keys, zero @google/genai)
import { auth } from '../firebase';
import type { MarketAnalysis, ClassificationResult, TradePulse } from '../types';

const API = '/api/v1/ai';

async function authedFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const token = await user.getIdToken();                       // Firebase ID token (foundation §3.2)
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  const body = await res.json();
  if (!res.ok || body.ok === false) {
    throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  }
  return body.data as T;                                        // unwrap ApiSuccess envelope
}

export const analyzeProduct = (description: string, originCountry: string) =>
  authedFetch<MarketAnalysis>('/analyze', { method: 'POST', body: JSON.stringify({ description, originCountry }) });

export const classifyProduct = (description: string, answers?: Record<string, string>) =>
  authedFetch<ClassificationResult>('/classify', { method: 'POST', body: JSON.stringify({ description, answers }) });

export const fetchMarketDetails = (productName: string, hsCode: string, origin: string, destination: string) =>
  authedFetch('/market-details', { method: 'POST', body: JSON.stringify({ productName, hsCode, origin, destination }) });

export const fetchTradePulse = (country: string) =>
  authedFetch<TradePulse>(`/trade-pulse?country=${encodeURIComponent(country)}`);

export const askExpert = (
  message: string,
  history: { role: 'user' | 'model'; parts: { text: string }[] }[],
  context: { productName: string; hsCode: string; origin: string; destination: string },
) => authedFetch<{ reply: string }>('/ask-expert', { method: 'POST', body: JSON.stringify({ message, history, context }) })
      .then((d) => d.reply);
```

The function **signatures and return types are preserved**, so existing call-sites (components) do not
change — only the implementation moves behind HTTP. `getTradeLawCacheId`/`getPulseCacheId` are no longer
exported from the client (server-only now); if any component imports them, update the import (grep:
`getTradeLawCacheId|getPulseCacheId` — file-level change list §10).

---

## 3. Workstream 2 — Remove the bundle key

**Why:** `vite.config.ts:10–13` injects `GEMINI_API_KEY` (and `GOOGLE_MAPS_PLATFORM_KEY`) into the client
bundle via `define`. Vite string-replaces `process.env.GEMINI_API_KEY` with the literal key at build time —
so the key ships to every browser. This is the core "secret in the bundle" violation (BUILD_PLAN §0 #1).

### 3.1 Exact change to `vite.config.ts`

Delete the entire `define` block. The Maps key, if the client genuinely needs it, is a *publishable,
referrer-restricted* browser key and must be handled separately (Phase 6 / not Phase 0) — for Phase 0 it is
removed from `define` too, and the map either uses a runtime-fetched restricted key or is feature-flagged
off. Result:

```typescript
// vite.config.ts (after)
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');          // kept; no longer used to inject secrets
  return {
    plugins: [react(), tailwindcss()],
    // NOTE: the `define` block injecting GEMINI_API_KEY / GOOGLE_MAPS_PLATFORM_KEY is REMOVED.
    // No secret may be string-replaced into the client bundle (BUILD_PLAN §0 #1, foundation ADR-013).
    resolve: { alias: { '@': path.resolve(__dirname, '.') } },
    server: { hmr: process.env.DISABLE_HMR !== 'true' },
  };
});
```

### 3.2 Where the key moves

`GEMINI_API_KEY` is read **only** in `server/services/llm/gemini.ts` from `process.env` at server boot
(see §2.3). `server.ts` already does `import 'dotenv/config'` as its first line (must stay — CLAUDE.md /
foundation §5.3), so local dev loads it from `.env`; production injects it from GCP Secret Manager
(ADR-004 / devops-engineer). The env var name is unchanged (`GEMINI_API_KEY`, foundation §5.3); only its
*reachability* changes — server process only, never the bundle.

`.env.example` is updated to document `GEMINI_API_KEY` as **server-only**; `.gitignore` already excludes
`.env` (verify — file-level list §10).

### 3.3 Verification (and a CI guard)

```bash
npm run build
# 1) The injected env-var reference must be gone from the bundle:
! grep -rqE 'process\.env\.GEMINI_API_KEY|GOOGLE_MAPS_PLATFORM_KEY' dist/
# 2) The actual secret value must not appear anywhere in dist (incl. .map source maps):
KEY="$(node -e 'require("dotenv").config(); process.stdout.write(process.env.GEMINI_API_KEY||"__none__")')"
! grep -rqF "$KEY" dist/
# 3) @google/genai must not be in the client chunk graph (heuristic):
! grep -rqi 'GoogleGenAI' dist/assets/*.js
```
Each `! grep -q ... ` exits non-zero (fails the gate) if the pattern is found. Wire this as a **CI step**
(`devops-engineer`: dep-scan/SAST stage) so a regression that re-bundles the key blocks merge. This is the
machine-checkable form of exit-metric #1.

---

## 4. Workstream 3 — Auth middleware (firebase-admin) + claim-based RBAC

**Why (BUILD_PLAN §0 / §7 AuthN/Z, ADR-006):** the server is the trust boundary. Every API call must carry
a Firebase ID token that the server verifies; authorization must be a server-verified **custom claim**, not
the hardcoded `amankr4883@gmail.com` string currently in `firestore.rules:28` (and implied admin logic).

### 4.1 `firebase-admin` token-verification middleware (real code)

```typescript
// server/middleware/auth.ts
import { type Request, type Response, type NextFunction } from 'express';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// Initialise the Admin SDK once. Credentials from server env (foundation §5.3); never in the bundle.
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // GCP Secret Manager stores the PEM with literal "\n"; restore them.
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

export interface AuthContext {
  firebaseUid: string;
  email: string | null;
  emailVerified: boolean;
  role: 'user' | 'expert' | 'admin';   // from custom claim; defaults to 'user'
  plan: 'free' | 'starter' | 'growth' | 'business';
}

// Augment Express' Request so downstream handlers are typed.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { auth?: AuthContext } }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    return res.status(401).json(unauth(req, 'Missing bearer token'));
  }
  try {
    // checkRevoked=true → a disabled/revoked session fails closed.
    const decoded = await getAuth().verifyIdToken(match[1], true);
    req.auth = {
      firebaseUid: decoded.uid,
      email: decoded.email ?? null,
      emailVerified: decoded.email_verified === true,
      role: (decoded.role as AuthContext['role']) ?? 'user',   // custom claim (W3.3)
      plan: (decoded.plan as AuthContext['plan']) ?? 'free',
    };
    return next();
  } catch {
    // Never leak verifier internals (safe error messages — backend-engineer DoD).
    return res.status(401).json(unauth(req, 'Invalid or expired token'));
  }
}

// Role gate — server-truth RBAC (no client-trusted authz). Use for admin-only routes.
export function requireRole(...roles: AuthContext['role'][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json(unauth(req, 'Not authenticated'));
    if (!roles.includes(req.auth.role)) {
      return res.status(403).json({
        ok: false,
        error: { code: 'PERMISSION_DENIED', message: 'Insufficient role', requestId: reqId(req) },
      });
    }
    return next();
  };
}

function unauth(req: Request, message: string) {
  return { ok: false, error: { code: 'UNAUTHENTICATED', message, requestId: reqId(req) } } as const;
}
function reqId(req: Request) { return (req.header('x-request-id') ?? cryptoRandom()); }
```

`req.auth` is the canonical user context for the request (foundation §3.2). Phase 0 stops there;
Phase 1 extends `requireAuth` to provision the `users` row and open `withUserTx` (`SET LOCAL app.user_id`,
foundation §5.5) — out of scope here (no Postgres yet).

### 4.2 Where it's applied

- **Mounted globally on the versioned API:** `app.use('/api/v1', requireAuth)` in `server.ts`, so **all**
  `/api/v1/*` routes — including the five AI endpoints (W1) — require a valid token. This is exit-metric #3.
- **Exemptions:** `GET /api/v1/health` (liveness) is mounted *before* the global guard (or uses an allow-list).
- **Legacy proxies:** the existing `/api/trade/comtrade` + `/api/trade/wto-tariff` are migrated under
  `/api/v1/trade/*` (foundation §3.1) and thus inherit `requireAuth`; thin legacy aliases at the old paths
  are kept during Strangler-Fig but **also** placed behind `requireAuth` (they were unauthenticated before —
  a latent abuse vector this closes). `/api/health` legacy alias stays open.
- **Admin-only routes** (none ship in Phase 0, but the gate exists): `requireRole('admin')`.

### 4.3 Replace the hardcoded admin email with a custom claim

**`firestore.rules` change** (line ~28): `isAdmin()` no longer compares an email; it reads the custom claim.

```diff
- function isAdmin() {
-   return isAuthenticated() && request.auth.token.email == "amankr4883@gmail.com" && request.auth.token.email_verified == true;
- }
+ function isAdmin() {
+   // Server-truth RBAC: admin is a Firebase custom claim set by a privileged process,
+   // never a client-editable field and never a hardcoded email (ADR-006, BUILD_PLAN §7/§8).
+   return isAuthenticated() && request.auth.token.role == "admin";
+ }
```

(The hardcoded email is also removed from any app-side admin logic; grep `amankr4883` across the repo —
file-level list §10 — must return **zero** matches after this workstream.)

**How the admin claim gets set** — a one-shot, server-side, privileged script (the *mechanism* Stripe
webhooks will reuse in Phase 4 to set `plan`/`role`). It is **not** an API endpoint reachable by clients.

```typescript
// scripts/set-admin-claim.ts   — run manually:  tsx scripts/set-admin-claim.ts <uid>
import 'dotenv/config';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

initializeApp({ credential: cert({
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
}) });

const uid = process.argv[2];
if (!uid) { console.error('usage: tsx scripts/set-admin-claim.ts <firebase-uid>'); process.exit(1); }

await getAuth().setCustomUserClaims(uid, { role: 'admin' });
console.log(`Set role=admin claim for ${uid}. User must refresh their ID token (re-login or getIdToken(true)).`);
```

The claim lands in the next ID token (`getIdToken(true)` forces refresh). Both `requireAuth` (reads
`decoded.role`) and `firestore.rules` (`request.auth.token.role == "admin"`) then see it — one source of
truth, server-set. No user can self-elevate (claims are not writable from the client SDK).

---

## 5. Workstream 4 — Kill the fabricated fallback

**Why (BUILD_PLAN §0 #3/#6, §3.6; backend-engineer + security-engineer anti-patterns):** `gemini.ts:216–226`
invents duty rates, tax rates, logistics costs, regulations, and a fake source URL from a character-code hash
when the real fetch fails. This is fabricated authoritative data presented as fact with a bogus
`https://wto.org/tariff-analysis` citation — the single most dangerous correctness bug. It must be **deleted**.

### 5.1 The replacement — foundation's designed-unknown shape

In the server-side `fetchRealTradeData` (now in `server/services/llm/gemini.ts`), the `catch` block at the
old 213–227 location returns the foundation §3.5 **`Resolved<T>`** unavailable state instead of fabricating:

```typescript
import type { Resolved } from '../../../shared/envelope';   // foundation §3.5 (Resolved<T> lives with envelope types)

// ...inside the per-destination loop's catch (replaces gemini.ts:215–226):
} catch (e) {
  console.error(`[market-details] authoritative fetch failed for ${dest.name}`, // no PII, no secrets
    e instanceof Error ? e.message : String(e));
  // BUILD_PLAN §3.6 / foundation §3.5 — NEVER fabricate. Absence of data is a designed state.
  results[dest.name] = {
    state: 'unavailable',
    reason: `No authoritative duty/tax data available for ${dest.name} on HS ${hsCode} from this route.`,
  } satisfies Resolved<never>;
}
```

Downstream (the synthesis prompt + the `MarketDetail` assembly): when a destination's hard numbers are
`{ state: 'unavailable' }`, the server **must not** ask the model to fill them in and must not coerce them
to numbers. The `simulationParams.dutyRate`/`taxRate` for that destination are emitted as `null` with a
`confidenceScore: 0`, and the response carries the unavailable state so the client renders the foundation's
"data unavailable for this route" UI (a Phase-1/2 UI affordance; Phase 0 at minimum returns the typed state
and the client shows the existing "unavailable"/empty treatment rather than a fabricated number).

> Phase 0 does **not** introduce the full provenance/conflict-resolution pipeline (foundation §3.3, §4) —
> that is Phase 1. Phase 0's obligation is narrow and absolute: **the fabrication is gone**, replaced by the
> typed unavailable state. Exit verification §11 greps for the hash-based fabrication and asserts it is absent.

---

## 6. Workstream 5 — Pin GA models (ADR-007)

**Why:** BUILD_PLAN §3.5 forbids `*-preview`; ADR-007 pins GA `gemini-2.5-flash` (synthesis/classification/
pulse/analysis) and `gemini-2.5-pro` (complex reasoning — "ask expert"). The live code uses preview IDs.

### 6.1 Centralize the IDs

```typescript
// server/services/llm/models.ts  — single source for model IDs (ADR-007; enables the §3.5 drift gate)
export const MODELS = {
  FLASH: 'gemini-2.5-flash',   // GA: synthesis, classification, trade-pulse, initial analysis
  PRO:   'gemini-2.5-pro',     // GA: ask-expert / complex reasoning
} as const;
export type ModelId = (typeof MODELS)[keyof typeof MODELS];
```

### 6.2 Mapping — every current call site → GA id

| gemini.ts line | Current (preview) | → GA (`MODELS.*`) | Function |
|---|---|---|---|
| 187 | `gemini-3-flash-preview` | `gemini-2.5-flash` (`MODELS.FLASH`) | `fetchRealTradeData` (synthesis w/ search) |
| 563 | `gemini-3-flash-preview` | `gemini-2.5-flash` | `analyzeProduct` |
| 586 | `gemini-3-flash-preview` | `gemini-2.5-flash` | `fetchMarketDetails` (tool-call step) |
| 628 | `gemini-3-flash-preview` | `gemini-2.5-flash` | `fetchMarketDetails` (synthesis step) |
| 690 | `gemini-3-flash-preview` | `gemini-2.5-flash` | `classifyProduct` |
| 734 | `gemini-3-flash-preview` | `gemini-2.5-flash` | `fetchTradePulse` |
| 818 | `gemini-3.1-pro-preview` | `gemini-2.5-pro` (`MODELS.PRO`) | `askExpert` |

All seven literals are removed; call sites reference `MODELS.FLASH` / `MODELS.PRO`. A CI guard greps the
server tree for `-preview` model strings and fails if any reappear (foundation ADR-007 / §3.5 drift gate seed).

---

## 7. Workstream 6 — npm vulnerabilities

**Why (BUILD_PLAN §7 supply-chain, security-engineer + devops-engineer DoD):** `npm audit` reports **28**
total (1 critical, 8 high, 18 moderate, 1 low). Phase 0's gate is the **1 critical + 8 high**; moderates are
cleaned opportunistically by the same upgrades and tracked into Phase 6.

> Versions below are the latest published at authoring time (2026-06-09); pin to the current patched
> release at implementation time. Targets verified via `npm view <pkg> version`.

### 7.1 The critical + 8 high — concrete remediation

| Pkg | Sev | Direct? | Vulnerable range (installed) | Advisory (gist) | Remediation |
|---|---|---|---|---|---|
| **protobufjs** | critical | transitive (via `firebase-admin` → `@google-cloud/firestore` → `google-gax`) | `<=7.5.7` | Arbitrary code execution / prototype injection / code injection via bytes-field defaults | **Upgrade `firebase-admin` to `^13.10.0`** (we already declare `^13.7.0`; the lockfile is pinning an old transitive tree). `npm update firebase-admin` + delete stale nested `protobufjs`. If a patched `protobufjs` (`>=7.5.8` / `8.x`) isn't pulled transitively, add an **npm `overrides`**: `"protobufjs": "^8.6.1"`. |
| **axios** | high | **direct** (`^1.13.6`) | `1.0.0 – 1.15.2` | SSRF via NO_PROXY bypass (RFC 1122 loopback) + prototype-pollution gadgets (auth bypass, response tampering) | **Upgrade direct dep to `axios@^1.17.0`** (`>=1.15.3` clears the high SSRF/prototype-pollution chain; 1.17.0 is current). Used in `server.ts` for WTO/Comtrade — SSRF fix is load-bearing for our egress proxy. |
| **vite** | high | **direct** (`^6.2.0`) | `<=6.4.1` | Path traversal in optimized-deps `.map`; arbitrary file read via dev-server WebSocket | **Upgrade to a patched line.** Minimal-blast option: `vite@^6.4.2+` (patched within v6). Note `vite@latest` is `8.x` — a major bump touches the plugin/`@vitejs/plugin-react` matrix; for Phase 0 take the **smallest patched v6** to stay reversible, and schedule the v6→8 major into Phase 2 (frontend-engineer, ADR-013). Update `@tailwindcss/vite` only if its peer range requires. |
| **react-router** | high | transitive (via `react-router-dom`) | `7.0.0 – 7.14.2` | turbo-stream RCE via TYPE_ERROR deserialization; open redirect via `//` protocol-relative; XSS in RSC redirect / prerendered Location header | **Upgrade `react-router-dom` to `^7.17.0`** (pulls patched `react-router >=7.14.3`). |
| **react-router-dom** | high | **direct** (`^7.13.1`) | `7.0.0-pre.0 – 7.14.1` | (inherits `react-router`) | **Upgrade direct dep to `react-router-dom@^7.17.0`.** Same major (7.x) — no breaking API change expected; smoke-test routes. |
| **node-forge** | high | transitive (via `firebase`/`firebase-admin` cert tooling) | `<=1.3.3` | basicConstraints bypass in cert-chain verification; Ed25519 / RSA-PKCS signature forgery; modInverse DoS | **Resolved by the `firebase`/`firebase-admin` upgrades** (they vendor the patched `node-forge >=1.3.4`). If still pinned old, add `overrides`: `"node-forge": "^1.4.0"`. |
| **path-to-regexp** | high | transitive (via `express` 4.x routing) | `<0.1.13` | ReDoS via multiple route params | **Upgrade `express` within 4.x** (`express@^4.22.x` resolves the patched `path-to-regexp`); `npm update express`. (Express **5** major is deferred to Phase 1 per ADR-001 scope note.) If the nested copy persists, `overrides`: `"path-to-regexp": "0.1.13"` for the express branch. |
| **fast-xml-builder / fast-xml-parser** | high / moderate | transitive (via `@google-cloud/storage` in firebase-admin tree) | `fast-xml-builder <=1.1.6` | attribute-value quote bypass allowing unwanted/malicious attributes | **Resolved by the `firebase-admin@^13.10.0` upgrade** (pulls patched `@google-cloud/storage` → `fast-xml-parser >=5.x`). Else `overrides`: `"fast-xml-parser": "^5.8.0"`. |
| **picomatch** | high | transitive (via `vite`/`tailwindcss`/`tinyglobby` build chain) | `4.0.0 – 4.0.3` | method injection in POSIX char classes (wrong glob matching) + ReDoS via extglob quantifiers | **Resolved by the `vite` upgrade**; if still old, `overrides`: `"picomatch": "^4.0.4"`. Build-time only (no runtime exposure) but fixed for hygiene/CI cleanliness. |

### 7.2 `overrides` block (use only where a transitive upgrade won't float)

```jsonc
// package.json — pin patched transitives that direct-dep upgrades don't lift
"overrides": {
  "protobufjs": "^8.6.1",
  "node-forge": "^1.4.0",
  "fast-xml-parser": "^5.8.0",
  "picomatch": "^4.0.4",
  "path-to-regexp": "0.1.13"
}
```

### 7.3 Procedure + acceptance
1. Bump the **direct** deps in `package.json`: `axios ^1.17.0`, `vite ^6.4.x` (latest patched v6),
   `react-router-dom ^7.17.0`, `firebase-admin ^13.10.0`.
2. `rm -rf node_modules package-lock.json && npm install` (clean resolve) — or `npm update` + targeted
   installs; then add the `overrides` (§7.2) for anything still flagged and reinstall.
3. `npm run lint` (tsc `--noEmit`) + `npm run build` must pass (catches the vite/react-router API drift).
4. **Acceptance:** `npm audit` shows **0 critical, 0 high**. Remaining moderates/low are triaged into a
   Phase 6 ticket (devops-engineer). Add `npm audit --audit-level=high` as a **CI gate** (fails the build on
   any new high/critical) + enable **Dependabot/SCA** (security-engineer + devops-engineer DoD).

---

## 8. Security checklist mapped to this phase (OWASP)

- **LLM01 Prompt Injection:** user text is data-only; system instruction server-side; output schema-validated
  (§2.2 note, ADR-011). **LLM05 Improper Output Handling:** zod/`safeJsonParse` validation; **LLM has zero DB
  write** — only server cache-fills with server-derived keys. **LLM06 Excessive Agency:** the only model
  "tool" is `fetch_authoritative_trade_data` which calls our **own** read-only WTO/Comtrade proxy — allow-list
  of one, no DB/agency. **LLM02/LLM07:** no secret ever placed in a prompt/context (key is process-env only).
  **LLM09 Misinformation:** the fabricated fallback (the worst misinformation vector) is deleted (W4).
- **Classic — Secrets:** no client-bundle key (W2). **AuthN/Z:** server-verified Firebase token every request;
  RBAC via custom claim; no client-trusted authz (W3). **CSRF:** bearer-token auth (not cookies) on the API —
  not CSRF-able. **Transport/CSP/HSTS/X-Frame-Options:** hardening headers (helmet) are a Phase-6 item; Phase 0
  adds the bearer-auth + removes the key (the highest-severity items). **Input validation:** zod at every AI
  endpoint boundary (W1). **Abuse:** minimal per-IP rate limit on `/api/v1/ai/*` (cheap guard; full WAF/limits
  Phase 6). **Supply chain:** W6 + Dependabot/SCA CI.

---

## 9. File-level change list

| File | Change | Workstream |
|---|---|---|
| `vite.config.ts` | **Delete** the `define` block injecting `GEMINI_API_KEY` + `GOOGLE_MAPS_PLATFORM_KEY`. | W2 |
| `src/services/gemini.ts` | **Rewrite** to a thin authed-fetch client (§2.4): remove `@google/genai` import, the `new GoogleGenAI` (line 57), all schemas/prompts/model calls, direct Firestore writes, and `handleFirestoreError`. Keep exported fn signatures. | W1, W2, W4, W5 |
| `server/services/llm/gemini.ts` | **New.** Sole holder of `new GoogleGenAI`; ports `analyzeProduct`/`classifyProduct`/`fetchMarketDetails`/`fetchTradePulse`/`askExpert` + `fetchRealTradeData` + schemas; **deletes** the fabricated fallback (W4); uses `MODELS.*` (W5); server-side Firestore cache writes keyed on `req.auth.firebaseUid`. | W1, W4, W5 |
| `server/services/llm/models.ts` | **New.** GA model-id constants (`FLASH`/`PRO`). | W5 |
| `server/services/llm/util.ts` | **New.** Port `withRetry` + `safeJsonParse`. | W1 |
| `server/routes/ai.ts` | **New.** Five endpoints (E1–E5), each `validate(zod)` + service call + envelope. | W1 |
| `server/middleware/auth.ts` | **New.** `requireAuth` (firebase-admin verify, attach `req.auth`) + `requireRole`. | W3 |
| `server/http/envelope.ts` (+ `shared/envelope.ts`) | **New.** `ApiSuccess`/`ApiError`/`ok()`/`AppError`/`ErrorCode` + `Resolved<T>` (foundation §3.3–3.5). | W1, W4 |
| `server/schemas/ai.ts` | **New.** zod request schemas for E1–E5. | W1 |
| `server.ts` | Mount `app.use('/api/v1', requireAuth)` then `aiRouter`; migrate `/api/trade/*` under `/api/v1/trade/*` (+ legacy aliases behind auth); keep health open; keep `import 'dotenv/config'` first line; minimal per-IP rate-limit on `/api/v1/ai/*`. | W1, W3 |
| `firestore.rules` | Replace `isAdmin()` email check (line 28) with `request.auth.token.role == "admin"`. | W3 |
| `scripts/set-admin-claim.ts` | **New.** One-shot privileged claim setter. | W3 |
| `package.json` | Bump `axios ^1.17.0`, `vite ^6.4.x`, `react-router-dom ^7.17.0`, `firebase-admin ^13.10.0`; add `overrides` (§7.2). | W6 |
| `package-lock.json` | Regenerated by clean install. | W6 |
| `.env.example` | Document `GEMINI_API_KEY` (+ `FIREBASE_PROJECT_ID`/`FIREBASE_CLIENT_EMAIL`/`FIREBASE_PRIVATE_KEY`) as **server-only**. | W2, W3 |
| `.gitignore` | Verify `.env` excluded (no change if already). | W2 |
| CI workflow (devops) | Add: bundle-key grep gate (§3.3), `-preview` model grep gate (§6.2), `npm audit --audit-level=high` gate (§7.3), Dependabot. | W2, W5, W6 |
| Any component importing `getTradeLawCacheId`/`getPulseCacheId` from `src/services/gemini.ts` | Update import (now server-only). Grep to confirm. | W1 |

---

## 10. Test / verification plan (prove each exit criterion)

**Exit #1 — no secret in built bundle:**
- `npm run build` then run the three `grep` assertions in §3.3 (env-ref absent, raw key value absent in
  `dist/**` incl. `.map`, `GoogleGenAI` absent from client chunks). All must pass. Wire as CI gate.

**Exit #2 — all AI calls server-side:**
- `grep -rE "@google/genai|new GoogleGenAI|process\.env\.GEMINI_API_KEY" src/` → **zero** matches.
- Network test: in the browser, trigger analyze/classify/pulse/details/ask-expert; DevTools Network shows
  requests **only** to `/api/v1/ai/*` (never `generativelanguage.googleapis.com`).
- Server unit/integration: each of E1–E5 returns the correct envelope for a valid request.

**Exit #3 — auth enforced:**
- `curl -s -o /dev/null -w '%{http_code}' -X POST localhost:3000/api/v1/ai/classify -d '{"description":"x"}' -H 'content-type: application/json'`
  → **401** (no token). With a valid `Authorization: Bearer <idToken>` → **200**. With a malformed/expired token → **401**.
- `requireRole('admin')` route: a non-admin token → **403 PERMISSION_DENIED**; a token carrying the
  `role:admin` claim (set via `scripts/set-admin-claim.ts`) → **200**.
- `grep -rF "amankr4883" .` → **zero** matches (hardcoded admin email gone from rules + code).
- `firestore.rules` test (emulator): a doc op gated by `isAdmin()` succeeds only for a token with
  `role == "admin"` claim.

**Exit (W4) — fabrication gone:**
- `grep -nE "charCodeAt|hash % 1[05]|wto.org/tariff-analysis" server/services/llm/gemini.ts src/services/gemini.ts`
  → **zero** matches (the hash-based fabrication + fake citation are deleted).
- Integration: force the authoritative fetch to fail (mock proxy 500) → `market-details` response carries
  `{ state: 'unavailable', reason: ... }` for that destination and **no** numeric duty/tax (null, confidence 0) —
  never a fabricated number.

**Exit (W5) — GA models:**
- `grep -rE "(gemini-3|[-]preview)" server/ src/` → **zero** matches; `server/services/llm/models.ts` is the
  only place model ids are defined.

**Exit (W6) — vulns:**
- `npm audit --audit-level=high` exits **0** (no high/critical). CI gate enforces.

**Regression smoke:** `npm run lint` (tsc) + `npm run build` pass; the five product flows work end-to-end
against a real Firebase test user.

---

## 11. Rollback + sequencing

### Sequencing (order of operations — each step independently shippable & reversible)
1. **W6 (deps) first** — upgrade/patch and reinstall; merge once `npm audit` + build are green. Lowest-risk,
   unblocks the auth SDK (firebase-admin) the rest needs.
2. **W3 (auth middleware + claim)** — land `requireAuth`/`requireRole`, the `firestore.rules` claim change,
   and `set-admin-claim.ts`. Run the claim script for the existing admin's uid *before* flipping the rule, so
   admin access is uninterrupted. At this point `/api/v1` is guarded but the AI routes don't exist yet — safe.
3. **W1 + W5 + W4 together** — stand up `server/services/llm/*` (GA models, no fabrication) + `server/routes/ai.ts`,
   then rewrite `src/services/gemini.ts` to the fetch client. These must ship in one PR because the client and
   server halves are interdependent (the client breaks the instant the old in-browser path is removed).
4. **W2 last** — delete the `define` block + add the bundle-grep CI gate. Doing this *after* W1 guarantees the
   client no longer needs the key, so removal can't break a still-in-browser call. Verify §3.3.

### Rollback
- **Per-workstream revert:** each step is its own PR/commit; `git revert` restores prior behavior. W6 rollback =
  restore the prior `package-lock.json`. W3 rollback = remove the middleware mount + restore the email-based
  `isAdmin()` (temporary). W1/W4/W5 rollback = revert the PR (client falls back to the old in-browser path —
  but **only if W2 hasn't shipped**). W2 rollback = restore the `define` block.
- **Hard dependency:** **W2 must never be live while W1 is reverted** — that combination = no key anywhere =
  AI fully down. The sequencing (W2 last) makes the safe rollback order simply the reverse: revert W2 before
  W1 if both must go.
- **Feature-flag option (devops-engineer, separate deploy from release):** gate the new client behind
  `VITE_AI_VIA_SERVER` so W1 can be dark-launched and flipped/reverted without a redeploy; remove the flag
  once Phase 0 is signed off. The key removal (W2) is **not** flag-gated — it is the irreversible-by-design
  security win and ships only after the server path is proven.

---

## 12. References
- Foundation: ADR-006 (auth), ADR-007 (GA models), ADR-011 (zod/validation), ADR-013 (Vite/no-bundle-key);
  §3.1–3.5 (paths, envelopes, error taxonomy, designed-unknown); §5.1/5.3 (layout, env vars).
- BUILD_PLAN: §0 principles 1/2/3/6, §7 security (incl. OWASP LLM Top 10), §12 Phase 0 exit metric.
- Skills: `security-engineer` (OWASP LLM Top 10, Janca commandments, DoD), `backend-engineer` (server-owns-
  secrets/writes/authz, kill the fabricated fallback), `devops-engineer` (secrets out of code, CI dep-scan,
  reversible/flagged releases).
