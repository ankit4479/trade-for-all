# 04 — Phase 3: BYOK (Bring-Your-Own-Key) Tech Spec

> **Owning personas:** `backend-engineer` (Kleppmann + DHH) co-authoring with `security-engineer`
> (Janca + OWASP LLM Top 10). Flag for `legal-compliance-privacy`: WTO ToS on shared-caching of public
> tariff facts (§7).
> **Status:** v1 (2026-06-09). Authored against `00-foundation.md` (schema §2, API conventions §3,
> ADR-004 KMS envelope encryption, ADR-006 auth, ADR-011 zod, ADR-012 Drizzle), `BUILD_PLAN.md`
> §6/§7/§12, skill `wto-byok-onboarding`, memory `2026-06-08-byok-key-security-model.md`, and live
> `server.ts` (the shared-key WTO/Comtrade proxy this phase replaces).
> **Scope:** Per-user WTO API key, end-to-end. This spec does **not** re-decide anything locked in
> `00-foundation.md`; it references it. Where it needs a new rule, it states it explicitly.

---

## 0. References (do not redefine — cite)

| Need | Source of truth |
|---|---|
| `user_api_keys` columns (`ciphertext`, `encrypted_dek`, `iv`, `auth_tag`, `kek_version`, `status`, `last_validated_at`, unique `(user_id, provider)`) | `00-foundation.md` §2 |
| `apiKeyStatus` enum (`active` / `invalid` / `revoked`) | `00-foundation.md` §2 |
| KMS envelope-encryption scheme + `KmsClient` abstraction in `server/services/crypto.ts` | `00-foundation.md` ADR-004 |
| Auth (`req.auth = { userId, firebaseUid, role, plan }`), `withUserTx()` RLS wiring | `00-foundation.md` §3.2, §5.5 |
| Success / error envelopes + `ErrorCode` taxonomy | `00-foundation.md` §3.3, §3.4 |
| zod at every boundary; Drizzle parameterized only | ADR-011, ADR-012 |
| Onboarding portal facts (Azure-APIM, no iframe, Timeseries API) | skill `wto-byok-onboarding` |

---

## 1. Goal + exit metric (BUILD_PLAN §12)

**Goal:** A user connects their **own** WTO API key through an in-app guided flow; the server validates
it with a real WTO call, envelope-encrypts it, and stores ciphertext only. From then on, that user's
WTO tariff lookups use **their** key (per-user 10/sec quota, no global throttle). The plaintext key
**never** reaches the browser, never crosses tenants, and is never logged.

**Exit metric:** *A real WTO key is connected end-to-end and live WTO data flows for that user; the key
is never client-side.* Concretely, all of the following hold:

1. A user pastes a real WTO Primary key → server makes a live test call → key validates → row stored
   with `status='active'`, `last_validated_at` set.
2. A subsequent `GET /api/v1/trade/wto-tariff` for that user resolves the **per-user** key (decrypt
   in-memory → call WTO → discard), not the platform `WTO_API_KEY`.
3. Automated test proves the plaintext key appears in **no** HTTP response body, **no** client bundle,
   and **no** log line (§9 test plan).
4. Status chip flips 🟢 "WTO connected — verified live data".

**Non-goals (this phase):** Comtrade BYOK (schema is provider-generic and ready; UI deferred), billing
gates (Phase 4), the shared-cache write-back accuracy path (Phase 1 owns `hs_code_data` provenance — we
only *consume* it as fallback and note the ToS flag).

---

## 2. Onboarding flow spec

### 2.1 Why a guided checklist, not an embedded portal
The WTO API runs on **Azure API Management** at `https://apiportal.wto.org`, which sets
`X-Frame-Options: DENY` (verified, skill `wto-byok-onboarding`). We **cannot** iframe it. The flow is a
guided in-app checklist with **deep links** that open the portal in a new tab, plus a paste box.

### 2.2 The Azure-APIM steps (deep links the checklist renders)

| # | Step | Deep link | Done-signal in UI |
|---|---|---|---|
| 1 | Sign up | `https://apiportal.wto.org/signup` | user ticks "done" |
| 2 | Confirm email (verification link) | (email) | user ticks "done" |
| 3 | Sign in | `https://apiportal.wto.org/signin` | user ticks "done" |
| 4 | Products → **WTO Timeseries API** → Subscribe (name it) | `https://apiportal.wto.org/products` | user ticks "done" |
| 5 | Profile → reveal **Primary key** → Copy | `https://apiportal.wto.org/profile` | user ticks "done" |
| 6 | Paste key into our app → **Connect** | (in-app) | server validation result |

Each deep link opens with `target="_blank" rel="noopener noreferrer"` (no `window.opener` leak — Janca).
The checklist is purely client-side progress affordance; **only step 6 hits our server.**

### 2.3 Paste box + Connect (the only server-touching step)
- Single-line input, `type="password"`, `autocomplete="off"`, `spellcheck="false"`,
  `data-1p-ignore` / `data-lpignore="true"` (keep password managers from storing a third-party secret).
- On **Connect** → `POST /api/v1/byok/keys` (§5.1). The input is **cleared from React state immediately**
  after the request resolves (success or fail); the plaintext is never persisted client-side, never put
  in a URL/query string, never in `localStorage`/`sessionStorage`/IndexedDB.
- Submit over HTTPS only (HSTS already required, BUILD_PLAN §7).

### 2.4 Status chip states
Driven by `GET /api/v1/byok/keys/wto` (§5.2). The chip **never** receives the key — only a status enum.

| Chip | Condition (`status` + `lastValidatedAt`) | Copy |
|---|---|---|
| 🟢 connected | `status='active'` | "WTO connected — verified live data" |
| 🟡 needs attention | `status='invalid'` (last revalidation failed) | "WTO key stopped working — reconnect" |
| ⚪ not connected | no row OR `status='revoked'` | "Demo data — add your WTO key" |

⚪ is the default **demo / fallback mode**: users without a key still get value (served from the shared
`hs_code_data` cache or marked `{ state: 'unavailable' }` per `00-foundation.md` §3.5) — they are never
blocked. Adding a key upgrades them to live data.

---

## 3. Envelope encryption design (ADR-004)

### 3.1 Scheme (exact)
Per `00-foundation.md` ADR-004, GCP KMS holds the **KEK** (key-encryption-key); we generate a fresh
per-record **DEK** (data-encryption-key) for every stored token:

```
plaintext WTO key
   │  AES-256-GCM(plaintext, DEK, iv)  → ciphertext (+ 128-bit auth_tag)
   ▼
ciphertext                      stored in user_api_keys.ciphertext (base64)
DEK (32 random bytes)
   │  KMS.encrypt(DEK) under KEK  → encrypted_dek (KMS-wrapped)
   ▼
encrypted_dek                   stored in user_api_keys.encrypted_dek (base64)
iv (12 bytes)                   stored in user_api_keys.iv (base64)
auth_tag (16 bytes)             stored in user_api_keys.auth_tag (base64)
kek_version                     KMS key version that wrapped the DEK
```

The DEK exists in process memory only during encrypt/decrypt and is zeroed after use. The plaintext key
exists in process memory only during validation (§4) and at WTO-call time (§6), then discarded. **Nothing
plaintext is ever written to disk, a response body, or a log.**

### 3.2 The `KmsClient` abstraction (ADR-004 — one-file provider swap)
```typescript
// server/services/crypto.ts (interface; impl wraps @google-cloud/kms)
export interface KmsClient {
  /** Wrap a DEK under the KEK. Returns ciphertext + the KEK version used. */
  encryptDek(dek: Buffer): Promise<{ wrapped: Buffer; kekVersion: string }>;
  /** Unwrap a previously wrapped DEK. */
  decryptDek(wrapped: Buffer): Promise<Buffer>;
}
```
The GCP impl calls `KeyManagementServiceClient.encrypt({ name: GCP_KMS_KEY_NAME, plaintext })` and
`.decrypt(...)`; `kekVersion` is read from the `name` field on the encrypt response
(`.../cryptoKeyVersions/N`). Swapping to AWS KMS / Vault is a single-file change (ADR-004).

### 3.3 Real encrypt / decrypt helpers
```typescript
// server/services/crypto.ts
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import type { KmsClient } from './kmsClient';

const ALGO = 'aes-256-gcm';

export interface EnvelopeRecord {
  ciphertext: string;   // base64
  encryptedDek: string; // base64 (KMS-wrapped DEK)
  iv: string;           // base64 (12 bytes)
  authTag: string;      // base64 (16 bytes)
  kekVersion: string;
}

/** Encrypt a plaintext secret with a fresh per-record DEK, then KMS-wrap the DEK. */
export async function envelopeEncrypt(plaintext: string, kms: KmsClient): Promise<EnvelopeRecord> {
  const dek = randomBytes(32); // 256-bit DEK, per record
  const iv = randomBytes(12);  // 96-bit nonce for GCM
  try {
    const cipher = createCipheriv(ALGO, dek, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const { wrapped, kekVersion } = await kms.encryptDek(dek);
    return {
      ciphertext: ciphertext.toString('base64'),
      encryptedDek: wrapped.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      kekVersion,
    };
  } finally {
    dek.fill(0); // zero the DEK out of memory
  }
}

/** Decrypt an envelope record back to plaintext. In-memory only; never log the result. */
export async function envelopeDecrypt(rec: EnvelopeRecord, kms: KmsClient): Promise<string> {
  const dek = await kms.decryptDek(Buffer.from(rec.encryptedDek, 'base64'));
  try {
    const decipher = createDecipheriv(ALGO, dek, Buffer.from(rec.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(rec.authTag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(rec.ciphertext, 'base64')),
      decipher.final(), // throws if auth_tag mismatch (tamper / wrong key)
    ]);
    return plaintext.toString('utf8');
  } finally {
    dek.fill(0);
  }
}
```
`decipher.final()` throwing on auth-tag mismatch gives us **integrity** for free: a tampered ciphertext
or DEK fails closed (treated as `INTERNAL`, never a silent wrong key).

### 3.4 Repository (writes the foundation columns)
```typescript
// server/services/byok/repo.ts
import { eq, and } from 'drizzle-orm';
import { userApiKeys } from '../../db/schema';
import type { Tx } from '../../db/client';

export async function upsertKey(tx: Tx, userId: string, provider: 'wto' | 'comtrade', env: EnvelopeRecord) {
  await tx.insert(userApiKeys).values({
    userId, provider,
    ciphertext: env.ciphertext, encryptedDek: env.encryptedDek,
    iv: env.iv, authTag: env.authTag, kekVersion: env.kekVersion,
    status: 'active', lastValidatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [userApiKeys.userId, userApiKeys.provider], // unique (user_id, provider), §2 foundation
    set: {
      ciphertext: env.ciphertext, encryptedDek: env.encryptedDek,
      iv: env.iv, authTag: env.authTag, kekVersion: env.kekVersion,
      status: 'active', lastValidatedAt: new Date(), updatedAt: new Date(),
    },
  });
}

export async function getKeyRow(tx: Tx, userId: string, provider: 'wto' | 'comtrade') {
  const [row] = await tx.select().from(userApiKeys)
    .where(and(eq(userApiKeys.userId, userId), eq(userApiKeys.provider, provider)))
    .limit(1);
  return row ?? null;
}
```
All access goes through `withUserTx()` (foundation §5.5) so RLS (`user_id = app.user_id`) is enforced
in-DB — a missing or wrong `app.user_id` returns zero rows. **Defense-in-depth: even a query bug cannot
read another tenant's ciphertext.**

---

## 4. Key validation (validate-on-paste; store only on success)

### 4.1 WTO test-call contract
Use the same WTO host/header the live proxy already uses (`server.ts` line ~84/89), but as a **cheap,
deterministic** probe. The WTO API authenticates with `Ocp-Apim-Subscription-Key`; an invalid/unsub'd
key returns `401`/`403`, a valid key returns `200`.

- **Probe request:** a minimal WTO Timeseries/Tariff call with a tiny payload, e.g.
  `GET https://api.wto.org/timeseries/v1/reporters?lang=1` (small, stable, no large body) with header
  `Ocp-Apim-Subscription-Key: <pasted key>`, 10s timeout.
- **Decision logic:**

```typescript
// server/services/byok/validate.ts
import axios from 'axios';

const WTO_PROBE_URL = 'https://api.wto.org/timeseries/v1/reporters?lang=1';

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: 'unauthorized' | 'forbidden' | 'upstream' | 'timeout' };

/** Server-side test call. Returns ok only on HTTP 200. NEVER logs the key. */
export async function validateWtoKey(plaintextKey: string): Promise<ValidationResult> {
  try {
    const res = await axios.get(WTO_PROBE_URL, {
      headers: { 'Ocp-Apim-Subscription-Key': plaintextKey, Accept: 'application/json' },
      timeout: 10_000,
      validateStatus: () => true, // we inspect status ourselves
    });
    if (res.status === 200) return { ok: true };
    if (res.status === 401) return { ok: false, reason: 'unauthorized' }; // bad/typo'd key
    if (res.status === 403) return { ok: false, reason: 'forbidden' };    // not subscribed to product
    return { ok: false, reason: 'upstream' };
  } catch (err: any) {
    if (err.code === 'ECONNABORTED') return { ok: false, reason: 'timeout' };
    return { ok: false, reason: 'upstream' };
  }
}
```

### 4.2 Validation rules (enforce)
1. **Store only on `{ ok: true }`** (HTTP 200). A bad key returns an inline error and is **never**
   persisted (skill requirement 1).
2. The distinction `unauthorized` (typo / wrong key) vs `forbidden` (valid key but not subscribed to the
   WTO Timeseries API) drives the user-facing hint ("check you subscribed to the Timeseries API in
   step 4").
3. `upstream`/`timeout` (WTO is down) → do **not** store; return `502 UPSTREAM_UNAVAILABLE` with
   "couldn't reach WTO to verify your key, try again" — do not blame the user's key.
4. On success → envelope-encrypt (§3) → `upsertKey` with `status='active'`, `last_validated_at=now()`.

### 4.3 Periodic re-validation (skill requirement 4)
A pg-boss scheduled job (`byok:revalidate`, ADR-002) runs **weekly** and on first call-time failure:
- For each `active` WTO key: decrypt in-memory → run `validateWtoKey` → discard plaintext.
- `{ ok:true }` → bump `last_validated_at`. `unauthorized`/`forbidden` → set `status='invalid'` (chip →
  🟡). `upstream`/`timeout` → leave unchanged (don't penalize the user for WTO downtime).
- Emit an `events` row (`type='byok_revalidate'`, payload `{ provider, result }`) — **no key material**.

---

## 5. API endpoints

All under `/api/v1` (foundation §3.1), all require `Authorization: Bearer <Firebase ID token>`
(§3.2), all bodies zod-validated (ADR-011), all DB access via `withUserTx()` (§5.5). Responses use the
`ApiSuccess`/`ApiError` envelopes (§3.3/§3.4). **No endpoint ever returns key material.**

### 5.1 `POST /api/v1/byok/keys` — connect (validate + encrypt + store)
```typescript
// server/schemas/byok.ts
import { z } from 'zod';
export const ConnectKeyBody = z.object({
  provider: z.enum(['wto']), // comtrade added later; schema is provider-generic
  key: z.string().min(8).max(256).trim(),
});

// server/routes/byok.ts
router.post('/byok/keys', validate(ConnectKeyBody), async (req, res, next) => {
  const { provider, key } = req.body as z.infer<typeof ConnectKeyBody>;
  try {
    // 1. validate-on-paste (live WTO call) — store only on success
    const result = await validateWtoKey(key);
    if (!result.ok) {
      if (result.reason === 'unauthorized')
        return res.status(422).json(apiError(req, 'VALIDATION_FAILED', 'That WTO key was rejected (401). Re-copy your Primary key.'));
      if (result.reason === 'forbidden')
        return res.status(422).json(apiError(req, 'VALIDATION_FAILED', 'Key is valid but not subscribed to the WTO Timeseries API (403). Complete step 4.'));
      return res.status(502).json(apiError(req, 'UPSTREAM_UNAVAILABLE', 'Could not reach WTO to verify your key. Try again shortly.'));
    }
    // 2. envelope-encrypt + 3. store ciphertext only
    const env = await envelopeEncrypt(key, kms);
    await withUserTx(req.auth, (tx) => upsertKey(tx, req.auth.userId, provider, env));
    // 4. respond with STATUS ONLY — never the key
    return res.status(201).json(apiSuccess(req, { provider, status: 'active', lastValidatedAt: new Date().toISOString() }));
  } catch (err) {
    next(err); // KMS failure etc → errorHandler maps to INTERNAL (§7.3); key never logged
  } finally {
    // best-effort: drop the reference; GC reclaims. (Node strings are immutable — see §7.2 note.)
  }
});
```
Idempotency: connecting the same provider twice replaces the row (`onConflictDoUpdate`); safe to retry.

### 5.2 `GET /api/v1/byok/keys/:provider` — status (chip)
```typescript
router.get('/byok/keys/:provider', async (req, res) => {
  const provider = z.enum(['wto', 'comtrade']).parse(req.params.provider);
  const row = await withUserTx(req.auth, (tx) => getKeyRow(tx, req.auth.userId, provider));
  // Project to a STATUS-ONLY DTO. ciphertext/encrypted_dek/iv/auth_tag NEVER serialized.
  return res.json(apiSuccess(req, {
    provider,
    connected: !!row && row.status === 'active',
    status: row?.status ?? 'not_connected',
    lastValidatedAt: row?.lastValidatedAt?.toISOString() ?? null,
  }));
});
```
**Hard rule:** the DTO whitelist is explicit. We never `res.json(row)` — that would serialize ciphertext.

### 5.3 `DELETE /api/v1/byok/keys/:provider` — disconnect
```typescript
router.delete('/byok/keys/:provider', async (req, res) => {
  const provider = z.enum(['wto', 'comtrade']).parse(req.params.provider);
  await withUserTx(req.auth, (tx) =>
    tx.update(userApiKeys).set({ status: 'revoked', updatedAt: new Date() })
      .where(and(eq(userApiKeys.userId, req.auth.userId), eq(userApiKeys.provider, provider))));
  // Soft-revoke (status='revoked') is the default; chip → ⚪. A hard delete variant
  // (?purge=true) physically removes the row + ciphertext for data-subject erasure (Phase 4 GDPR).
  return res.json(apiSuccess(req, { provider, status: 'revoked' }));
});
```

### 5.4 Endpoint summary
| Method | Path | Body / params | Returns | Notes |
|---|---|---|---|---|
| POST | `/api/v1/byok/keys` | `{ provider, key }` | `{ provider, status, lastValidatedAt }` | validate → encrypt → store; 201 |
| GET | `/api/v1/byok/keys/:provider` | — | `{ provider, connected, status, lastValidatedAt }` | chip data, status only |
| DELETE | `/api/v1/byok/keys/:provider` | `?purge?` | `{ provider, status:'revoked' }` | soft revoke (default) / hard purge |

---

## 6. Refactored WTO/Comtrade proxy (per-user key resolution)

### 6.1 The change
Today (`server.ts` lines ~53, ~89) the proxy uses one shared env key for everyone:
`'Ocp-Apim-Subscription-Key': process.env.WTO_API_KEY`. Phase 3 replaces this with **per-user
resolution**: decrypt the caller's key in-memory → use it for this one request → discard. The platform
`WTO_API_KEY` becomes the **demo/fallback** key only (⚪ users), still server-side, never bundled.

### 6.2 Key resolver (decrypt → use → discard)
```typescript
// server/services/byok/resolve.ts
import { getKeyRow } from './repo';
import { envelopeDecrypt } from '../crypto';

export interface ResolvedKey { key: string; source: 'byok' | 'platform_demo'; }

/** Resolve the WTO key for THIS user. Per-user BYOK wins; platform key is demo fallback. */
export async function resolveWtoKey(auth: { userId: string; role: string }): Promise<ResolvedKey | null> {
  const row = await withUserTx(auth, (tx) => getKeyRow(tx, auth.userId, 'wto'));
  if (row && row.status === 'active') {
    const key = await envelopeDecrypt(
      { ciphertext: row.ciphertext, encryptedDek: row.encryptedDek, iv: row.iv, authTag: row.authTag, kekVersion: row.kekVersion },
      kms,
    );
    return { key, source: 'byok' };
  }
  if (process.env.WTO_API_KEY) return { key: process.env.WTO_API_KEY, source: 'platform_demo' };
  return null; // no BYOK, no platform key → demo/unavailable state
}
```
The decrypted plaintext lives only inside the proxy handler's stack frame for the duration of the
outbound WTO call. It is **not** attached to `req`, **not** cached, **not** returned.

### 6.3 Refactored proxy handler
```typescript
// server/routes/trade.ts (replaces server.ts app.get('/api/trade/wto-tariff', ...))
router.get('/trade/wto-tariff', perUserRateLimit('wto', 10 /* req/sec */), async (req, res, next) => {
  const { hsCode, reporter } = WtoTariffQuery.parse(req.query); // zod (ADR-011)

  const resolved = await resolveWtoKey(req.auth);
  if (!resolved) {
    // ⚪ no key at all → designed "unavailable", not a 500 (foundation §3.5)
    return res.json(apiSuccess(req, { state: 'unavailable', reason: 'no_wto_key' }));
  }

  try {
    const paddedReporter = String(reporter).padStart(3, '0');
    const url = `https://api.wto.org/tariff/v1/tariff?r=${paddedReporter}&p=000&pc=${encodeURIComponent(hsCode)}&fmt=json`;
    const upstream = await axios.get(url, {
      headers: { 'Ocp-Apim-Subscription-Key': resolved.key }, // per-user key, in-memory only
      timeout: 30_000,
    });
    // (Phase 1 owns write-back to shared hs_code_data cache with provenance — see §7 ToS flag.)
    return res.json(apiSuccess(req, upstream.data, { /* provenance: WTO */ }));
  } catch (err: any) {
    if (err.response?.status === 404) return res.json(apiSuccess(req, { state: 'unavailable', reason: 'no_data_for_route' }));
    if (err.response?.status === 401 || err.response?.status === 403) {
      // The user's BYOK key just failed at call time → mark invalid, surface 🟡 reconnect.
      if (resolved.source === 'byok') {
        await withUserTx(req.auth, (tx) =>
          tx.update(userApiKeys).set({ status: 'invalid', updatedAt: new Date() })
            .where(and(eq(userApiKeys.userId, req.auth.userId), eq(userApiKeys.provider, 'wto'))));
      }
      return res.status(502).json(apiError(req, 'UPSTREAM_UNAVAILABLE', 'WTO rejected the request. Reconnect your key.'));
    }
    next(err);
  }
});
```
The Comtrade proxy (`server.ts` `/api/trade/comtrade`) is refactored identically with
`resolveComtradeKey` (`provider='comtrade'`); the platform `UN_COMTRADE_API_KEY` stays the demo
fallback. The schema/crypto/resolver are already provider-generic, so this is a thin addition.

### 6.4 No plaintext on `req`
`resolveWtoKey` returns the key as a local; the handler must not assign it to `req`, a closure that
outlives the request, or any logger MDC. Reviewed in §9 test plan.

---

## 7. Per-user quota / trust model

### 7.1 Per-user 10/sec quota (NOT a global throttle) — BUILD_PLAN §6
The trust model is: it's the user's own WTO key and their own WTO rate budget, so we do **not** globally
throttle BYOK traffic. We apply a **per-user** limiter to protect the user from accidentally exceeding
WTO's own limits and to bound abuse.

```typescript
// server/middleware/rateLimit.ts (per-user, per-provider; keyed on userId, not IP)
import rateLimit from 'express-rate-limit';
export const perUserRateLimit = (provider: string, perSecond: number) => rateLimit({
  windowMs: 1_000,
  limit: perSecond,                       // 10 req/sec per user (BUILD_PLAN §6)
  keyGenerator: (req) => `${provider}:${req.auth.userId}`, // per-user, NOT global
  standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => res.status(429).json(apiError(req, 'RATE_LIMITED', 'WTO quota: 10 requests/sec. Slow down.')),
});
```
This is distinct from the global cost circuit-breaker (BUILD_PLAN §9) which only guards **paid Gemini
calls**, not BYOK WTO calls (the user pays WTO directly). A BYOK user's WTO usage costs us $0, so it is
deliberately not metered against the `usage`/COGS gate.

### 7.2 Shared cache of public tariff facts still applies — ToS flag
WTO tariff/timeseries data are **public trade facts**. Per skill requirement 6, results fetched with a
**personal** key are still cached in the **shared** `hs_code_data` table (so the next user — even a ⚪
demo user — gets an instant, cheap hit; this is the margin lever, Kleppmann: load = unique routes, not
users). **Open ToS question — flag for `legal-compliance-privacy` (Phase 4 legal pass, BUILD_PLAN §12):**
confirm WTO's API Terms of Service permit caching/redistributing data fetched under one user's
subscription to other users. Until confirmed, gate shared write-back behind a flag
`BYOK_SHARED_CACHE_WRITEBACK` (default **off**); BYOK responses are still served live and may be cached
**per-user** (private `embeddings`/`hs_code_data` scoping) without the ToS risk.

### 7.3 Note on Node string immutability
JS strings are immutable and cannot be reliably zeroed; the DEK (a `Buffer`) **is** zeroed (§3.3). We
minimize plaintext-key lifetime instead: decrypt immediately before the WTO call, never store on `req`,
never log, let it go out of scope right after. This is the documented, accepted limitation (not a gap).

---

## 8. Security checklist + threat model (security-engineer gate)

### 8.1 Key handling across the three states
| State | Control |
|---|---|
| **At rest** | Envelope-encrypted (AES-256-GCM under a KMS-wrapped per-record DEK, §3). Ciphertext-only in `user_api_keys`. RLS `user_id = app.user_id` (foundation §5.5) — even a query bug can't cross tenants. DB user is not superuser, no `BYPASSRLS`. |
| **In transit (client→us)** | HTTPS/HSTS only; key in POST body (never URL/query — no key in access logs or browser history). Input cleared from client state post-request (§2.3). |
| **In transit (us→WTO)** | HTTPS to `api.wto.org`; key only in the `Ocp-Apim-Subscription-Key` header of the single outbound call. |
| **In logs** | **Redaction is mandatory.** A logger redactor strips `key`, `Ocp-Apim-Subscription-Key`, `ciphertext`, `encrypted_dek`, `authorization`. We never `console.log` the request body of `POST /byok/keys`. The existing `server.ts` `console.error(... JSON.stringify(errorData))` lines are reviewed so an upstream error body can't echo the key. |
| **In responses** | Status-only DTOs (§5.2); never `res.json(row)`. Asserted by test (§9). |
| **Cross-tenant** | RLS + per-request `withUserTx`; resolver reads only the caller's row. |
| **Client bundle** | No BYOK key, no platform `WTO_API_KEY`, in the Vite bundle (ADR-013; platform key is server env only). Asserted by test (§9). |

### 8.2 OWASP mapping (security-engineer skill)
- **A02 Cryptographic Failures:** authenticated encryption (GCM auth-tag → tamper-evident), per-record
  DEK (no key reuse across users), KMS-held KEK.
- **A01 Broken Access Control:** RLS + Firebase token verify every request; status-only DTOs.
- **A09 Logging Failures:** redaction; audit `events` rows for connect/revoke/revalidate (no key material).
- **LLM-path:** N/A to BYOK directly, but the decrypted key is **never** placed into a prompt/context
  window (LLM02/LLM07 — "system prompts are not security controls"). WTO data feeding RAG is sanitized
  by Phase 1's existing chunk pipeline.

### 8.3 What happens on KMS failure
- **Encrypt fails** (connect path): the connect request returns `500 INTERNAL` ("couldn't securely store
  your key, try again"); **nothing is stored** (we never store an unencrypted or partial record). Key is
  discarded.
- **Decrypt fails** (proxy path): we do **not** fall back to plaintext (there is none) and do **not**
  silently use the platform key as if it were the user's. We fail closed: `502 UPSTREAM_UNAVAILABLE`
  ("temporary problem accessing your key"), alert fires, chip stays 🟢 (key is fine; KMS is down). A
  KMS-down dashboard alert is wired (devops, Phase 6).
- **Auth-tag mismatch on decrypt** (tamper / corruption): `decipher.final()` throws → treated as
  `INTERNAL`, alert; the row is **not** auto-deleted (needs human triage — could indicate DB tampering).

### 8.4 Rotation
- **KEK rotation:** KMS rotates the KEK to a new version; old versions stay enabled for decrypt. We store
  `kek_version` per row; **lazy re-wrap** (ADR-004): next time a key is decrypted at call time, if its
  `kek_version` is older than current, re-`envelopeEncrypt` and update the row (DEK is regenerated too).
  No mass re-encryption job needed.
- **DEK:** one per record, regenerated on every `envelopeEncrypt` (connect, reconnect, lazy re-wrap).
- **User key rotation:** the user re-copies a new Primary key from the WTO portal and reconnects;
  `onConflictDoUpdate` replaces the row. Revoked WTO keys naturally fail revalidation → `status='invalid'`.

---

## 9. File-level change list + test plan

### 9.1 Files
| File | Change |
|---|---|
| `server/services/crypto.ts` | **New.** `envelopeEncrypt`/`envelopeDecrypt` (§3.3) + GCP `KmsClient` impl (`encryptDek`/`decryptDek`). |
| `server/services/byok/repo.ts` | **New.** `upsertKey`, `getKeyRow` (parameterized Drizzle, §3.4). |
| `server/services/byok/validate.ts` | **New.** `validateWtoKey` live probe (§4.1). |
| `server/services/byok/resolve.ts` | **New.** `resolveWtoKey` / `resolveComtradeKey` (decrypt→use→discard, §6.2). |
| `server/routes/byok.ts` | **New.** POST/GET/DELETE endpoints (§5). |
| `server/routes/trade.ts` | **Refactor** of `server.ts` `/api/trade/wto-tariff` + `/api/trade/comtrade` to per-user resolution (§6.3). Shared-env-key usage removed from the user path; platform key demoted to demo fallback. |
| `server/middleware/rateLimit.ts` | **Add** `perUserRateLimit(provider, perSecond)` (§7.1). |
| `server/schemas/byok.ts` | **New.** `ConnectKeyBody`, `WtoTariffQuery` zod schemas. |
| `server/jobs/revalidateByok.ts` | **New.** pg-boss weekly revalidation (§4.3). |
| `server/middleware/logger.ts` | **Add** redaction for `key`/`Ocp-Apim-Subscription-Key`/`ciphertext`/`encrypted_dek`/`authorization` (§8.1). |
| `src/components/byok/ConnectWtoChecklist.tsx` | **New.** Guided checklist + deep links + paste box (§2). |
| `src/components/byok/WtoStatusChip.tsx` | **New.** 🟢/🟡/⚪ chip reading `GET /byok/keys/wto` (§2.4). |
| `src/services/byok.ts` | **New.** Client calls to the 3 endpoints; clears key from state post-request. |
| `.env` / Secret Manager | `GCP_KMS_KEY_NAME` already in foundation §5.3; ensure present. `WTO_API_KEY` retained as **demo fallback** only. |

> Note: `server.ts` is being decomposed into `server/` per foundation §5.1 (ADR-001). This phase adds the
> `byok.ts`/refactored `trade.ts` routes within that structure; if the decomposition hasn't landed yet,
> the same handlers are added to `server.ts` and migrated with the rest.

### 9.2 Test plan
**Unit**
- `crypto.test.ts`: `envelopeDecrypt(envelopeEncrypt(x)) === x`; tampering `ciphertext`/`authTag`/`iv`
  makes decrypt **throw** (auth-tag integrity); DEK differs across two encrypts of the same plaintext.
- `validate.test.ts`: WTO 200 → `{ok:true}`; 401 → `unauthorized`; 403 → `forbidden`; timeout → `timeout`
  (mock axios).

**Integration / contract**
- `POST /byok/keys` with a mocked WTO 200 → row persisted, `status='active'`, `last_validated_at` set;
  response body contains **no** `ciphertext`/`key`/`encrypted_dek` (assert via deep key-scan of JSON).
- `POST /byok/keys` with mocked WTO 401 → **422**, **no row written** (assert table empty).
- `GET /byok/keys/wto` → returns status-only DTO; assert the serialized response has none of
  `ciphertext|encryptedDek|iv|authTag`.
- Tenant isolation: user A connects; user B's `GET`/proxy must not see A's key (RLS) — assert B gets
  `not_connected` and the proxy uses platform demo for B.

**"Key never reaches client" (exit-metric proof)**
- Build the client (`vite build`) and grep the `dist/` bundle for the test WTO key string and for
  `WTO_API_KEY` → **must be absent** (CI gate).
- Capture all HTTP responses in the e2e connect test and assert the plaintext key substring appears in
  **none** of them.
- Run the connect flow with logging at debug and grep captured logs → key substring **absent**
  (redaction proof).

**E2E connect (the exit metric)**
- Playwright: open checklist → paste a real (test) WTO key → Connect → assert chip flips 🟢 → call
  `GET /api/v1/trade/wto-tariff?hsCode=...&reporter=...` → assert response is live WTO data and the
  outbound call used the per-user key (mock/inspect the WTO header in a test double), not `WTO_API_KEY`.
- Negative: DELETE the key → chip ⚪ → proxy returns `{ state:'unavailable', reason:'no_wto_key' }` (or
  platform demo if configured), never a 500.

**Security (with qa-tester gate)**
- Attempt to read another tenant's key via API → denied (RLS).
- Inject a malformed/oversized key body → zod `422`.
- Simulate KMS decrypt failure at proxy time → `502`, fail-closed, no plaintext fallback, alert emitted.

---

## 10. Definition of Done (skill `wto-byok-onboarding` + both personas)
- [ ] User connects a real WTO key through the guided checklist; validated live; stored envelope-encrypted; chip 🟢; live WTO data flows for that user.
- [ ] Plaintext key never client-side (bundle + response + log grep all clean — CI gates).
- [ ] Per-user 10/sec quota enforced (not global); BYOK WTO calls not metered against COGS.
- [ ] Validate-on-paste stores only on 200; bad key → inline error, nothing stored.
- [ ] Decrypt in-memory at call time only; discarded after; RLS tenant isolation tested fail-safe.
- [ ] KMS-failure paths fail closed (no plaintext fallback); rotation = lazy re-wrap by `kek_version`.
- [ ] Backend DoD (auth/ownership/quota server-side; zod; Drizzle parameterized; safe errors) + Security DoD (OWASP classic + LLM Top 10 reviewed; redaction; audit `events`) both signed off.
- [ ] WTO ToS shared-caching question routed to `legal-compliance-privacy`; write-back gated behind `BYOK_SHARED_CACHE_WRITEBACK` until cleared.
```
