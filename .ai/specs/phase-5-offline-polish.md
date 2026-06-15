# Phase 5 — Offline + Polish (enterprise feel) — Tech Spec

> **Owning skills:** `frontend-engineer` (Osmani — performance is a feature; PWA/offline craft) +
> `ui-ux-designer` (Linear-grade craft), **co-authored with** `product-manager` (Cagan/Torres/Doshi —
> outcomes, four risks, pre-mortem). Correction-queue domain rules validated by `trade-customs-expert`.
> **Status:** v1 (2026-06-09). Authored against `.ai/specs/00-foundation.md` (the single source of truth)
> and `.ai/BUILD_PLAN.md` v2 (§5 offline-first, §3.6 correction loop, §4.4/§4.6 cached-first + graceful
> degradation, §8 usage/quota, §12 Phase-5 exit metric).
> **Scope:** Client-side (`src/`) PWA + offline cache + the three new surfaces (usage dashboard, flag-as-wrong
> affordance, expert review queue). **This spec re-decides nothing locked in the foundation.** Every contract,
> schema, envelope, error code, and provenance/freshness type is *referenced*, not redefined.

---

## 0. How this spec fits the foundation

| This phase needs… | Comes from foundation (do NOT redefine) |
|---|---|
| `data_corrections` table shape | `00-foundation.md` §2 (`dataCorrections` Drizzle table) + `correctionSource`/`correctionStatus` enums |
| Flag + review endpoints' envelopes | §3.3 `ApiSuccess<T>` / §3.4 `ApiError` + `ErrorCode` taxonomy |
| Provenance / freshness rendering types | §4 `shared/provenance.ts` — `Provenance`, `Freshness`, `ConfidenceBand`, `computeFreshness`, `bandOf` |
| Usage data shape | §2 `usage` table (`deepAnalyses`, `classifications`, `cogsMicroUsd`, `periodMonth`) |
| Auth on every call | §3.2 `Authorization: Bearer <Firebase ID token>` |
| PWA decision | §ADR-013 ("evolve to PWA + code-split", JS ≤170KB initial, LCP<2.5s, INP<200ms) |
| RBAC for the review queue | §ADR-006 (role is a Firebase custom claim: `user` / `expert` / `admin`) |
| "Designed unknown" rendering | §3.5 `Resolved<T>` union |

**Dependency on Phase 1 (hard):** Phase 1 builds the `data_corrections` backend (table + RLS) and the
**flag endpoint** + **approved-override lookup** in the read path. Phase 5 builds the **UI** on top:
the flag-as-wrong affordance and the expert review queue. If a Phase-1 endpoint is missing, Phase 5
defines the exact contract it expects (§6) so backend and frontend can land in the same milestone — but
Phase 5 does **not** re-implement override-resolution logic.

**Dependency on Phase 4 (soft):** the usage dashboard *reads* Phase-4 usage/quota data. If Phase 4's
`GET /api/v1/account/usage` is not yet shipped, the dashboard degrades to an empty state (§4.3) — it never
blocks the offline/corrections work, which is the exit metric.

---

## 1. Goal + exit metric

**Outcome (PM frame, Cagan):** The product should *feel* like enterprise software a customs broker trusts
with a deal — it survives a flaky airport/warehouse network, it never shows a number without saying where
it came from and how fresh it is, and when it's wrong a user can say so and an expert can fix it for
*everyone*. Two user problems:

1. **"I'm on a bad connection at a port / on a flight and I still need the analysis I already pulled."**
   → Offline read of cached data.
2. **"This duty rate is wrong and I have no way to tell anyone — so I stop trusting the whole product."**
   → Human-in-the-loop correction loop, visible end-to-end.

**Exit metric (BUILD_PLAN §12):**
- **Works offline for cached data** — with the network disabled, a previously-visited analysis/route route
  renders from IndexedDB within the LCP budget, behind a clear "showing cached data" banner; the app shell
  loads offline (no white screen).
- **Corrections loop live** — a user can flag any displayed factual value; it appears in the expert review
  queue (admin/expert-gated); on approve, the approved override is what subsequent reads serve (Phase-1
  precedence: expert override wins), visible to that user on next fetch.

**Success metrics to instrument (PM — measure before/after, not vanity):**
- Offline-served-render rate (sessions that hit cache while `navigator.onLine === false`).
- Repeat-load LCP delta (app-shell precache should cut repeat-visit LCP materially).
- Flag-submit rate and **flag→approval cycle time** (expert SLA).
- % of displayed factual values carrying a visible source + freshness stamp (target **100%**, BUILD_PLAN §0 trust metric).

**Four big risks (Cagan) — assessed up front:**
- **Value:** offline read of *already-fetched* data is genuinely useful for field users; corrections turn a
  trust-killer into a trust-builder. ✅
- **Usability:** flag affordance must be discoverable but not noisy (one icon per factual value, not a wall
  of buttons). Mitigated by the design in §5.
- **Feasibility:** PWA + Dexie + TanStack Query are all in the foundation stack; no new backend. ✅
- **Viability:** zero added COGS — offline serves *cached* data (no live RAG offline, §5 BUILD_PLAN); the
  correction loop *reduces* future LLM spend by promoting facts to overrides. ✅

**Pre-mortem (Doshi) — "if this fails in 6 months, why?":**
- A bad service-worker caused a stuck/stale shell users couldn't escape → **mitigation:** versioned SW,
  `skipWaiting` behind an explicit "Update available — reload" prompt, kill-switch (§2.6).
- Offline cache served a *stale tariff as if current* → **mitigation:** freshness stamp + `isStale` flag is
  mandatory on every cached value; offline banner is non-dismissible while offline (§3.5).
- Flag spam floods the queue → **mitigation:** per-user rate-limit on flags (server, §6.1), dedupe identical
  pending flags client-side, and the queue is triageable (filter/sort, §5.3).
- Expert overrides go live without review → **mitigation:** UI never writes `status='approved'` directly;
  approval is an admin/expert-gated server transition (§6.2). Client RBAC is **display-only** (§5.4).

---

## 2. PWA setup

### 2.1 Strategy (Osmani: ship the shell instantly, work offline)

Two cache layers, clearly separated:

| Layer | What | SW strategy | Why |
|---|---|---|---|
| **App shell** | HTML entry, JS/CSS chunks, fonts, icons, the offline fallback page | **Precache** (cache-first, revision-hashed by the build) | Instant repeat loads + works with zero network. This is what makes the app open offline. |
| **Static assets** | images, map topojson, logos | **CacheFirst** w/ expiration | Rarely change; cheap to serve from cache. |
| **API GETs (reference + user data)** | `/api/v1/**` reads | **NetworkFirst** (timeout 4s → cache fallback) **and** mirrored into IndexedDB by the app (§3) | Fresh-when-online, last-known-when-offline. NetworkFirst keeps data current; the Dexie mirror is the source of truth the React layer reads so we control the "showing cached" UX. |
| **API writes / AI / SSE** | `POST/PATCH /api/v1/**`, `/jobs/:id/stream`, anything LLM | **NetworkOnly** — never cached | "No live RAG offline" (BUILD_PLAN §5). Writes must not be silently served from cache. SSE is not cacheable. |

**Decision:** the **Dexie/IndexedDB mirror (§3) is the read source for the React app**, not the SW HTTP
cache. The SW HTTP cache exists to (a) boot the shell offline and (b) be a NetworkFirst fallback for any
fetch we didn't explicitly mirror. This avoids two competing offline truths and lets us attach the
mandatory "cached data / last verified" UI to every value (the SW cache can't carry that UX).

### 2.2 `vite-plugin-pwa` config (foundation stack — ADR-013)

Add `vite-plugin-pwa` (dev dep) + `workbox-window` (runtime). Wire into the existing `vite.config.ts`
(preserving the `define`-removal from Phase 0 — no key changes here).

```typescript
// vite.config.ts (additions only — keep existing react()/tailwind()/resolve/server blocks)
import { VitePWA } from 'vite-plugin-pwa';

// inside plugins: [...]
VitePWA({
  registerType: 'prompt',                 // NEVER silent auto-update — show "Update available" (§2.6, pre-mortem)
  injectRegister: null,                   // we register manually via workbox-window (§2.5) for the prompt UX
  strategies: 'generateSW',               // Workbox-generated SW; no custom SW file to maintain (v1)
  manifest: false,                        // we ship a hand-authored manifest.webmanifest (§2.3) for full control
  includeAssets: ['favicon.svg', 'icons/*.png', 'offline.html'],
  workbox: {
    globPatterns: ['**/*.{js,css,html,svg,woff2}'],   // precache the app shell
    navigateFallback: '/offline.html',                 // offline navigations with no cache → branded offline page
    navigateFallbackDenylist: [/^\/api\//],            // never serve the offline page for API routes
    cleanupOutdatedCaches: true,
    clientsClaim: true,
    skipWaiting: false,                                // controlled by the update prompt, not automatic
    runtimeCaching: [
      {
        // Reference + user-data GETs: fresh when online, fall back to cache offline.
        urlPattern: ({ url, request }) =>
          url.pathname.startsWith('/api/v1/') && request.method === 'GET',
        handler: 'NetworkFirst',
        options: {
          cacheName: 'api-get-v1',
          networkTimeoutSeconds: 4,
          expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 }, // 30d ceiling; freshness UX is per-value (§3)
          cacheableResponse: { statuses: [200] },
        },
      },
      {
        urlPattern: ({ url }) => /\.(?:png|jpg|jpeg|svg|webp|json)$/.test(url.pathname),
        handler: 'CacheFirst',
        options: {
          cacheName: 'static-assets',
          expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 60 },
          cacheableResponse: { statuses: [200] },
        },
      },
    ],
  },
  devOptions: { enabled: false },          // do NOT run SW in dev (it fights HMR / the server.ts Vite middleware)
}),
```

**Notes:**
- `POST/PATCH/DELETE` and `/jobs/:id/stream` are **not** matched by any `runtimeCaching` rule → they fall
  through to the network (NetworkOnly by omission). Explicitly documented so no one adds a rule that caches a write.
- Auth header: NetworkFirst caches the response body keyed by URL; because all `/api/v1` GETs are
  user-scoped behind RLS and the response is per-user, we **must** clear the `api-get-v1` SW cache on
  logout (§2.6) so a second user on the same device never sees the first user's cached responses. The Dexie
  mirror is likewise wiped on logout (§3.6).

### 2.3 Web app manifest (real JSON) — `public/manifest.webmanifest`

```json
{
  "name": "Trade-for-All — Global Trade Intelligence",
  "short_name": "Trade-for-All",
  "description": "Sourced, confidence-rated trade intelligence for SME exporters. Works offline for cached data.",
  "id": "/",
  "start_url": "/?source=pwa",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait-primary",
  "background_color": "#0B0F17",
  "theme_color": "#0B0F17",
  "lang": "en",
  "dir": "ltr",
  "categories": ["business", "productivity", "finance"],
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
    { "src": "/icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "shortcuts": [
    { "name": "New analysis", "short_name": "Analyze", "url": "/?action=new", "icons": [{ "src": "/icons/icon-192.png", "sizes": "192x192" }] },
    { "name": "Usage & quota", "url": "/account/usage" }
  ]
}
```

Linked from `index.html` `<head>` (the existing `index.html` has no manifest/theme tags yet — add them):

```html
<link rel="manifest" href="/manifest.webmanifest" />
<meta name="theme-color" content="#0B0F17" />
<link rel="apple-touch-icon" href="/icons/icon-192.png" />
```

### 2.4 `offline.html` — branded offline fallback (no white screen)

A tiny standalone page (precached) shown only when the user navigates to a route with no cached shell while
offline. Carries brand mark + "You're offline. Cached analyses are still available — reopen the app." and a
Retry button. Must be < 5KB, inline CSS, no JS dependency on the bundle.

### 2.5 SW registration with update prompt — `src/pwa/registerSW.ts`

```typescript
// src/pwa/registerSW.ts
import { registerSW } from 'virtual:pwa-register';

export interface SWState {
  needRefresh: boolean;
  offlineReady: boolean;
  update: () => void;
}

export function initServiceWorker(onState: (s: SWState) => void): void {
  if (import.meta.env.DEV) return; // never in dev (§2.2)
  const updateSW = registerSW({
    onNeedRefresh() {
      onState({ needRefresh: true, offlineReady: false, update: () => updateSW(true) });
    },
    onOfflineReady() {
      onState({ needRefresh: false, offlineReady: true, update: () => {} });
    },
  });
}
```

Wired in `src/main.tsx`; the state feeds a small `<UpdatePrompt>` toast ("A new version is available —
Reload") and a one-time "Ready to work offline" toast. `update()` calls `skipWaiting` + reloads.

### 2.6 Kill-switch + per-user cache hygiene
- **Logout / user switch:** call `caches.delete('api-get-v1')` and wipe the Dexie DB (§3.6) so cached
  per-user responses never leak across accounts on a shared device.
- **Kill-switch:** if a release ships a broken SW, publish a build whose SW calls
  `self.registration.unregister()` + `clients.claim()`; `registerType: 'prompt'` + `cleanupOutdatedCaches`
  means users recover on next load. Documented in the runbook.

---

## 3. IndexedDB offline cache (Dexie)

The Dexie mirror is the **read source** for the React app (§2.1). TanStack Query fetches online; on
success it writes-through to Dexie; when `navigator.onLine === false` (or a fetch fails), the query reads
from Dexie and the UI flips into "showing cached data" mode.

### 3.1 What gets mirrored (BUILD_PLAN §5)
- **User's own data:** `user_products` (classification history → "same product again → instant"), the
  user's own analyses (`analysis_jobs.result` for completed jobs), profile, and the latest usage snapshot.
- **Last-known reference results:** the resolved reference payloads the user has actually viewed —
  `hs_code_data`-derived analysis sections **with their `Provenance` + `Freshness`** attached. We mirror
  *what the user fetched*, not the whole corpus (privacy + size).
- **Pending flags (outbox):** locally-submitted corrections the user made offline, queued for replay (§3.5).

**Never mirrored:** other tenants' data (RLS already prevents fetching it), BYOK keys, anything secret,
live RAG (there is none offline).

### 3.2 Dexie schema (real TS) — `src/offline/db.ts`

```typescript
// src/offline/db.ts
import Dexie, { type Table } from 'dexie';
import type { Provenance, Freshness } from '../../shared/provenance';

/** A mirrored API GET response, generic over the resolved payload. */
export interface CachedResource {
  key: string;                 // canonical cache key, e.g. 'analysis:HS6=090111|US->IN' (§3.3)
  kind: 'analysis' | 'reference' | 'user_product' | 'usage' | 'profile';
  data: unknown;               // the ApiSuccess<T>.data payload as served
  provenance: Provenance | null; // §4 foundation — null for pure user-data (no source claim)
  freshness: Freshness | null;   // §4 foundation — drives "last verified" + isStale
  etag: string | null;         // if the server sends one (NetworkFirst revalidation)
  fetchedAt: number;           // epoch ms when this device fetched it (drives "cached as of …")
  userId: string;              // owner — for the logout wipe + cross-user safety assertion
}

/** User's own classification history (mirror of user_products). */
export interface CachedUserProduct {
  id: string;
  userId: string;
  query: string;
  hsCode: string | null;
  clarifiers: Record<string, string>;
  updatedAt: number;           // last-write-wins key (§3.4)
  fetchedAt: number;
}

/** Offline-submitted flags awaiting replay (the correction outbox, §3.5). */
export interface PendingFlag {
  localId: string;             // crypto.randomUUID() — client temp id
  userId: string;
  body: FlagWrongRequest;      // §6.1 contract
  createdAt: number;
  status: 'pending' | 'syncing' | 'synced' | 'error';
  error?: string;
  serverId?: string;           // data_corrections.id once synced
}

/** Re-declared here only as the request shape; the canonical contract is §6.1. */
export interface FlagWrongRequest {
  hsCode?: string;
  originCountry?: string;
  destinationCountry?: string;
  fieldGroup: string;
  field: string;
  correctedValue?: unknown;    // optional — user may just flag "this is wrong" without a fix
  rationale?: string;
  sourceUrl?: string;
  idempotencyKey: string;      // §3.7 foundation — survives replay
}

export class OfflineDB extends Dexie {
  resources!: Table<CachedResource, string>;
  userProducts!: Table<CachedUserProduct, string>;
  pendingFlags!: Table<PendingFlag, string>;

  constructor() {
    super('trade-for-all-offline');
    this.version(1).stores({
      // primary key first, then secondary indexes
      resources: 'key, kind, userId, fetchedAt',
      userProducts: 'id, userId, hsCode, updatedAt',
      pendingFlags: 'localId, userId, status, createdAt',
    });
  }
}

export const offlineDb = new OfflineDB();
```

### 3.3 Cache keys (deterministic, route-scoped)
A single canonical key builder so writes and offline reads agree:
```typescript
// src/offline/keys.ts
export const cacheKey = {
  analysis: (hs: string, origin: string, dest: string) => `analysis:${hs}|${origin}->${dest}`,
  reference: (hs: string, fieldGroup: string, route?: string) =>
    `reference:${hs}|${fieldGroup}${route ? `|${route}` : ''}`,
  usage: (period: string) => `usage:${period}`,
  profile: (userId: string) => `profile:${userId}`,
};
```

### 3.4 Sync rules (BUILD_PLAN §5 — verbatim policy)
- **Reference data: server wins, always.** On reconnect/refetch, the server response **overwrites** the
  mirrored `CachedResource`. We never merge reference data; the authoritative copy is canonical (and
  expert overrides from the correction loop are part of that authority).
- **User data: last-write-wins per device.** `user_products` and profile use `updatedAt` as the LWW key —
  if the server row is newer, it wins; if a local optimistic write is newer (rare, only the outbox case),
  it's replayed then reconciled by the server response. There is no multi-device CRDT in v1 (explicitly out
  of scope — it's a read cache).
- **No live RAG offline.** Offline, the app serves *only* mirrored resources. Any action requiring a fresh
  LLM/retrieval call (new analysis, "ask expert", refresh) is disabled with an offline affordance (§5 polish).

### 3.5 Read path when offline + the outbox
```typescript
// src/offline/cachedQuery.ts — the read seam used by every data hook
import { offlineDb, type CachedResource } from './db';

export async function readCached<T = unknown>(key: string): Promise<CachedResource | undefined> {
  return offlineDb.resources.get(key) as Promise<CachedResource | undefined>;
}

export async function writeThrough(entry: CachedResource): Promise<void> {
  // server-wins for reference; LWW for user data is enforced by the caller via updatedAt compare.
  await offlineDb.resources.put(entry);
}
```

TanStack Query integration (the actual hook pattern — Osmani SWR):
```typescript
// src/hooks/useAnalysis.ts
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../api/client';            // attaches Firebase Bearer token (§3.2 foundation)
import { cacheKey } from '../offline/keys';
import { readCached, writeThrough } from '../offline/cachedQuery';

export function useAnalysis(hs: string, origin: string, dest: string) {
  const key = cacheKey.analysis(hs, origin, dest);
  return useQuery({
    queryKey: ['analysis', hs, origin, dest],
    queryFn: async () => {
      try {
        const res = await apiGet(`/api/v1/analysis?hs=${hs}&origin=${origin}&dest=${dest}`);
        await writeThrough({
          key, kind: 'analysis', data: res.data,
          provenance: res.meta?.provenance ?? null,
          freshness: res.meta?.freshness ?? null,
          etag: res.meta?.etag ?? null, fetchedAt: Date.now(), userId: res.meta!.userId,
        });
        return { source: 'network' as const, ...res.data, _meta: res.meta };
      } catch (e) {
        const cached = await readCached(key);
        if (cached) return { source: 'cache' as const, ...(cached.data as object), _meta: { provenance: cached.provenance, freshness: cached.freshness, fetchedAt: cached.fetchedAt } };
        throw e; // genuinely unavailable → caller renders the offline-empty state (§4 polish)
      }
    },
    networkMode: 'offlineFirst',
  });
}
```

**Outbox replay (corrections submitted offline):** a `useOnlineSync()` effect listens for the `online`
event; on reconnect it drains `pendingFlags` where `status='pending'`, POSTing each with its stored
`idempotencyKey` (§3.7 foundation guarantees a replay is safe — duplicate POSTs dedupe server-side). On
success it sets `status='synced'` + stores `serverId`; on failure `status='error'` with a retry affordance.

### 3.6 Cache hygiene on logout/user switch
`clearOfflineForUser()` deletes all Dexie rows where `userId !== currentUser` (and on full logout, wipes
the DB) **and** `caches.delete('api-get-v1')` (§2.6). Asserted in tests (cross-user leak test).

### 3.7 "Showing cached data" banner — `src/components/offline/CachedDataBanner.tsx`

```tsx
// src/components/offline/CachedDataBanner.tsx
import { WifiOff } from 'lucide-react';
import { formatRelativeTime } from '../../utils/time';

interface Props { fetchedAt: number; isOffline: boolean; }

export function CachedDataBanner({ fetchedAt, isOffline }: Props) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
      <span>
        {isOffline ? 'You’re offline. ' : ''}
        Showing cached data from <time dateTime={new Date(fetchedAt).toISOString()}>{formatRelativeTime(fetchedAt)}</time>.
        {isOffline ? ' Reconnect to refresh.' : ' Revalidating…'}
      </span>
    </div>
  );
}
```
Rules: rendered whenever a query resolves with `source: 'cache'`. While `isOffline` it is **non-dismissible**
(pre-mortem: never let a stale tariff masquerade as current). Pairs with the per-value freshness stamp (§5).

---

## 4. Usage dashboard

**Problem/outcome (PM):** users on metered plans (deep analyses, BUILD_PLAN §8) need to see where they
stand *before* they hit a wall — surprise `QUOTA_EXCEEDED` (§3.4) is a churn event. Outcome: a user can
answer "how much have I used and when does it reset?" in one glance, and upgrade in one click when near the cap.

### 4.1 Data source (reads Phase-4 usage data — §2 `usage` table)
`GET /api/v1/account/usage` → `ApiSuccess<UsageDashboard>` (Phase-4 contract; Phase 5 consumes it):
```typescript
// shape Phase 5 expects (Phase 4 owns the endpoint)
export interface UsageDashboard {
  periodMonth: string;           // 'YYYY-MM'
  periodResetsAt: string;        // ISO — start of next period
  plan: 'free' | 'starter' | 'growth' | 'business';
  meters: {
    deepAnalyses: { used: number; limit: number | null };      // null limit = unlimited (Business overage)
    classifications: { used: number; limit: number | null };
  };
  overageEnabled: boolean;       // Business tier (§8)
  cogsMicroUsd?: number;         // admin-only; omitted for normal users
}
```
Mirrored into Dexie (`kind: 'usage'`) so the dashboard renders offline as a "as of <date>" snapshot.

### 4.2 Quota states (under / near / over)
Single helper drives every meter's visual state:
```typescript
// src/account/quota.ts
export type QuotaState = 'unlimited' | 'under' | 'near' | 'over';
export function quotaState(used: number, limit: number | null): QuotaState {
  if (limit == null) return 'unlimited';
  const r = used / limit;
  if (r >= 1) return 'over';
  if (r >= 0.8) return 'near';      // 80% threshold → nudge to upgrade
  return 'under';
}
```
- **under** — neutral bar, "X of Y deep analyses used."
- **near (≥80%)** — amber bar + inline "Upgrade" CTA + "resets in N days."
- **over** — red bar, meter clamped at 100%, primary "Upgrade" CTA, copy: "You've used all Y for this
  period. Upgrade for more or wait until <reset date>." Matches server-side `QUOTA_EXCEEDED` (no
  client-trusted gating — §ADR-006; the server still enforces).
- **unlimited (Business)** — show usage count + (if `overageEnabled`) "Overage billed at $… per analysis."

### 4.3 Component — `src/components/account/UsageDashboard.tsx`
shadcn/Tailwind. Renders a `MeterRow` per meter (progress bar + label + state-colored), the period
reset chip, and a plan card with the upgrade CTA. States: loading (skeleton bars, no spinner — Osmani),
error (retry), offline ("as of <date>" + banner), empty (Phase-4 endpoint absent → "Usage will appear once
billing is connected").

```tsx
function MeterRow({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const state = quotaState(used, limit);
  const pct = limit == null ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const tone = { unlimited: 'bg-sky-500', under: 'bg-emerald-500', near: 'bg-amber-500', over: 'bg-red-500' }[state];
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-zinc-400">{limit == null ? `${used} (unlimited)` : `${used} / ${limit}`}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-zinc-800" role="progressbar"
           aria-valuenow={used} aria-valuemin={0} aria-valuemax={limit ?? used} aria-label={label}>
        <div className={`h-2 rounded-full ${tone} transition-[width]`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
```

---

## 5. Human-in-the-loop correction UI

Two surfaces: (A) the **flag-as-wrong** affordance on any displayed factual value (every user), and (B) the
**expert review queue** (admin/expert only). Both wire to the Phase-1 `data_corrections` backend.

### 5.1 The factual-value primitive — `src/components/data/FactValue.tsx`
**Decision (trust + craft):** every factual value the app displays is rendered through ONE component that
carries (1) the value, (2) the **source + confidence + freshness** chips (§4 foundation types — the
BUILD_PLAN §0 100%-sourced trust metric), and (3) the flag affordance. This guarantees consistency: there
is no way to show a number without provenance, and the flag entry point is uniform.

```tsx
// src/components/data/FactValue.tsx
import { useState } from 'react';
import { Flag } from 'lucide-react';
import type { Provenance, Freshness } from '../../../shared/provenance';
import { ConfidenceChip } from './ConfidenceChip';
import { FreshnessStamp } from './FreshnessStamp';
import { FlagWrongDialog } from '../corrections/FlagWrongDialog';

interface FactValueProps {
  label: string;
  children: React.ReactNode;     // the rendered value (safe — no raw HTML; markdown via react-markdown)
  provenance: Provenance;        // §4 foundation
  freshness: Freshness;          // §4 foundation
  // identity of WHAT is being flagged (maps to data_corrections route+field, §2 foundation)
  target: { hsCode?: string; originCountry?: string; destinationCountry?: string; fieldGroup: string; field: string };
  currentValue: unknown;         // pre-fills the dialog "current value"
}

export function FactValue({ label, children, provenance, freshness, target, currentValue }: FactValueProps) {
  const [flagOpen, setFlagOpen] = useState(false);
  return (
    <div className="group flex items-start gap-2">
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
        <div className="text-zinc-100">{children}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <ConfidenceChip provenance={provenance} />
          <FreshnessStamp freshness={freshness} />
        </div>
      </div>
      <button
        type="button"
        onClick={() => setFlagOpen(true)}
        aria-label={`Flag “${label}” as wrong`}
        className="ml-auto opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100
                   rounded p-1 text-zinc-500 hover:text-amber-400"
      >
        <Flag className="h-4 w-4" aria-hidden />
      </button>
      <FlagWrongDialog open={flagOpen} onOpenChange={setFlagOpen} target={target} currentValue={currentValue} label={label} />
    </div>
  );
}
```

`ConfidenceChip` renders `bandOf(provenance.confidence)` + source label + a "verify" hint for `Medium`,
and an "unverified source" warning when `provenance.citationVerified === false` (§3.4 foundation).
`FreshnessStamp` renders **"last verified: <date>"** and an amber "stale — verify" tag when
`freshness.isStale` (§3.2 foundation). These appear on *every* value (offline too — they come from the
mirrored `Provenance`/`Freshness`).

### 5.2 Flag-as-wrong dialog — `src/components/corrections/FlagWrongDialog.tsx`
shadcn `Dialog`. Fields: shows the current value (read-only), optional **corrected value**, optional
**rationale**, optional **source URL** (the more the user gives, the faster review). Submitting POSTs the
**Phase-1 flag endpoint** (§6.1) with `source: 'user_flag'`, an `Idempotency-Key`, and the route+field
`target`. Online → optimistic toast "Flagged — thanks, an expert will review." Offline → queued in the
Dexie outbox (§3.5) with toast "Flag saved — will submit when you're back online."

```tsx
async function submitFlag(body: FlagWrongRequest, online: boolean) {
  if (online) {
    return apiPost('/api/v1/corrections', body, { idempotencyKey: body.idempotencyKey });
  }
  await offlineDb.pendingFlags.add({
    localId: crypto.randomUUID(), userId: currentUserId, body, createdAt: Date.now(), status: 'pending',
  });
}
```
Client-side dedupe: before adding to the outbox / posting, check for an existing pending flag on the same
`(target, correctedValue)` to prevent accidental double-submit (pre-mortem: flag spam).

### 5.3 Expert review queue — `src/components/corrections/ReviewQueue.tsx` (route `/admin/corrections`)
Lists **pending `data_corrections`** (§2 foundation) for expert/admin. Columns: route (HS / origin→dest),
field group · field, **current value vs proposed corrected value** (diff), source (`user_flag`/`expert`),
submitter, rationale, source URL (linked), submitted-at. Actions per row: **Approve** / **Reject** (reject
requires a reason). Filters: status (default `pending`), field group, source; sort by oldest-first
(SLA-driven). Cursor pagination per §3.6 foundation.

```tsx
// data hooks
const { data } = useQuery({
  queryKey: ['corrections', 'pending', cursor],
  queryFn: () => apiGet(`/api/v1/admin/corrections?status=pending&limit=25${cursor ? `&cursor=${cursor}` : ''}`),
});

const approve = useMutation({
  mutationFn: (id: string) =>
    apiPatch(`/api/v1/admin/corrections/${id}`, { status: 'approved' }, { idempotencyKey: crypto.randomUUID() }),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['corrections', 'pending'] }),
});
const reject = useMutation({
  mutationFn: ({ id, reason }: { id: string; reason: string }) =>
    apiPatch(`/api/v1/admin/corrections/${id}`, { status: 'rejected', reviewerNote: reason }, { idempotencyKey: crypto.randomUUID() }),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['corrections', 'pending'] }),
});
```
On **approve**, the server (Phase 1) records the reviewer, sets `status='approved'`, `reviewedAt`, and that
correction now wins in the read path (precedence: expert override, BUILD_PLAN §3.3). The UI optimistically
removes the row and shows "Approved — now overriding for all users." Approving/rejecting uses an
`Idempotency-Key` (§3.7 foundation) so a double-click can't double-process.

### 5.4 RBAC gating (display-only — server is the source of truth, §ADR-006)
The `/admin/corrections` route + the queue are guarded by a client check on the Firebase custom claim
(`role` ∈ {`expert`,`admin`}) purely to **hide** the surface — never to authorize. The endpoints
themselves enforce `PERMISSION_DENIED` (§3.4) server-side; a user hitting the API directly without the
claim is rejected by the server regardless of client state. No client-trusted authz (frontend-engineer
anti-pattern).

```tsx
function RequireRole({ roles, children }: { roles: Array<'expert' | 'admin'>; children: React.ReactNode }) {
  const { claims } = useAuth();              // from the verified ID token claims
  if (!claims || !roles.includes(claims.role)) return <NotAuthorized />; // hides UI only
  return <>{children}</>;
}
```

---

## 6. API contracts this phase consumes (defined by Phase 1; restated for the build)

> Phase 1 owns the implementation + RLS. Phase 5 is the client. All envelopes are §3.3/§3.4 foundation;
> all status transitions are idempotent (§3.7). The `data_corrections` shape is §2 foundation.

### 6.1 Flag a value — `POST /api/v1/corrections` (any authenticated user)
- **Body** (`FlagWrongRequest`, §3.2): `{ hsCode?, originCountry?, destinationCountry?, fieldGroup, field, correctedValue?, rationale?, sourceUrl?, idempotencyKey }`.
- Server sets `source='user_flag'`, `submittedBy=req.auth.userId`, `status='pending'`.
- **Headers:** `Authorization: Bearer <token>`, `Idempotency-Key: <uuid>`.
- **Success:** `201 ApiSuccess<{ id: string; status: 'pending' }>`.
- **Errors:** `VALIDATION_FAILED` (422), `RATE_LIMITED` (429 — flag-spam guard), `UNAUTHENTICATED` (401).

### 6.2 List pending corrections — `GET /api/v1/admin/corrections` (expert/admin)
- **Query:** `status` (default `pending`), `fieldGroup?`, `source?`, `limit` (1..100, default 25), `cursor?`.
- **Success:** `ApiSuccess<CorrectionRow[]>` with `meta.pagination` (§3.6). `CorrectionRow` projects the
  §2 `dataCorrections` columns + joined submitter email + the **current served value** for the diff.
- **Errors:** `PERMISSION_DENIED` (403) for non-expert/admin.

### 6.3 Review a correction — `PATCH /api/v1/admin/corrections/:id` (expert/admin)
- **Body:** `{ status: 'approved' | 'rejected'; reviewerNote?: string }`.
- Server sets `reviewer`, `reviewedAt`, transitions `status`; on `approved` the correction becomes the
  override in the read path (precedence, BUILD_PLAN §3.3). Approved corrections are added to the golden set
  by Phase-1 tooling (§3.6 BUILD_PLAN) — **not** a Phase-5 responsibility.
- **Headers:** `Idempotency-Key`.
- **Success:** `200 ApiSuccess<{ id; status; reviewedAt }>`.
- **Errors:** `CONFLICT` (409) if already reviewed, `PERMISSION_DENIED` (403), `NOT_FOUND` (404).

### 6.4 Usage — `GET /api/v1/account/usage` (Phase 4) → `ApiSuccess<UsageDashboard>` (§4.1).

---

## 7. Polish pass (enterprise feel) — concrete checklist

> PM + `ui-ux-designer` craft lens. Each item ties to an outcome: **trust**, **perceived speed**, or
> **never-dead-end**. This is the difference between "an app" and "software a broker bets a shipment on."

**Trust (BUILD_PLAN §0 — 100% sourced + fresh):**
- [ ] **Freshness stamp on every factual value** — "last verified: <date>", amber "stale — verify" when
      `freshness.isStale`. Renders offline too (from the mirror). *(Outcome: trust.)*
- [ ] **Source + confidence visibility on every value** — source label + `ConfidenceBand` chip; "verify" on
      `Medium`, "unverified source" on `citationVerified === false`; "sources disagree" surfaces both
      candidates (§3.5 `Resolved` `sources_disagree`). *(Trust.)*
- [ ] **"Showing cached data" banner** — non-dismissible while offline; "revalidating…" while online-stale. *(Trust.)*
- [ ] **Designed-unknown rendering** — `unavailable`/`low_confidence` states (§3.5 foundation) render as
      honest empty states ("Data unavailable for this route"), never a blank or a guessed number. *(Trust.)*

**Never dead-end (graceful degradation, BUILD_PLAN §4.6):**
- [ ] **Empty states** for: no analyses yet, no flags in queue, no usage data, offline-with-nothing-cached
      (each with a clear next action). *(Never dead-end.)*
- [ ] **Error states** with retry — upstream `UPSTREAM_UNAVAILABLE`/`COST_CIRCUIT_OPEN` (§3.4) degrade to
      "showing cached / try again", never a raw stack or dead spinner. *(Never dead-end.)*
- [ ] **Offline-disabled affordances** — actions needing the network (new analysis, ask-expert, refresh)
      are visibly disabled offline with a tooltip "Unavailable offline", not silently broken. *(Never dead-end.)*
- [ ] **Quota near/over states** route to upgrade, not a wall (§4.2). *(Never dead-end.)*

**Perceived speed + craft (Osmani):**
- [ ] **Skeletons, not spinners** — every list/section/meter has a content-shaped skeleton; no layout shift
      (CLS<0.1). *(Perceived speed.)*
- [ ] **Cached-first render** — repeat visits paint from Dexie instantly, then revalidate (SWR). *(Perceived speed.)*
- [ ] **Route-level code-splitting** — `/admin/corrections`, `/account/usage`, heavy libs (jspdf, d3, maps)
      lazy-loaded; initial JS ≤170KB gzip enforced in CI (§ADR-013). *(Perceived speed.)*
- [ ] **Keyboard nav + a11y AA** — flag affordance reachable via keyboard (focus-visible), dialog focus-trap
      + ESC, queue rows operable by keyboard, `aria-live` on banners/toasts, progressbars labeled,
      visible focus rings. *(Craft / accessibility.)*
- [ ] **Loading craft** — optimistic flag/approve with rollback on error; toast confirmations; reduced-motion
      respected (`prefers-reduced-motion`). *(Craft.)*
- [ ] **Install/update craft** — "Ready to work offline" one-time toast; "Update available — Reload" prompt
      (§2.5), never a silent swap mid-session. *(Craft / trust.)*

---

## 8. File-level change list

**New — PWA / SW:**
- `vite.config.ts` — add `VitePWA(...)` plugin (§2.2). *(edit)*
- `public/manifest.webmanifest` — manifest (§2.3). *(new)*
- `public/offline.html` — offline fallback (§2.4). *(new)*
- `public/icons/{icon,maskable}-{192,512}.png`, `public/favicon.svg` — PWA icons. *(new assets)*
- `index.html` — `<link rel="manifest">` + `theme-color` + apple-touch-icon (§2.3). *(edit)*
- `src/pwa/registerSW.ts` — SW registration + update prompt (§2.5). *(new)*
- `src/components/pwa/UpdatePrompt.tsx` — "Update available" + "Offline ready" toasts. *(new)*
- `src/main.tsx` — call `initServiceWorker`, mount `QueryClientProvider`, `UpdatePrompt`. *(edit)*

**New — offline cache (Dexie):**
- `src/offline/db.ts` — Dexie schema (§3.2). *(new)*
- `src/offline/keys.ts` — cache-key builder (§3.3). *(new)*
- `src/offline/cachedQuery.ts` — read/write-through seam (§3.5). *(new)*
- `src/offline/sync.ts` — `useOnlineSync()` outbox drain (§3.5). *(new)*
- `src/offline/clear.ts` — `clearOfflineForUser()` logout wipe (§3.6). *(new)*
- `src/hooks/useOnline.ts` — `navigator.onLine` + online/offline listeners. *(new)*
- `src/components/offline/CachedDataBanner.tsx` — banner (§3.7). *(new)*
- `src/api/client.ts` — `apiGet/apiPost/apiPatch` attaching Firebase Bearer + Idempotency-Key. *(new or extend existing fetch layer)*

**New — usage dashboard:**
- `src/account/quota.ts` — `quotaState` (§4.2). *(new)*
- `src/components/account/UsageDashboard.tsx` + `MeterRow` (§4.3). *(new)*
- route `/account/usage` wired in the router (lazy). *(edit router)*

**New — corrections UI:**
- `src/components/data/FactValue.tsx` (§5.1) · `ConfidenceChip.tsx` · `FreshnessStamp.tsx`. *(new)*
- `src/components/corrections/FlagWrongDialog.tsx` (§5.2). *(new)*
- `src/components/corrections/ReviewQueue.tsx` (§5.3) + route `/admin/corrections` (lazy, role-guarded). *(new + router edit)*
- `src/components/auth/RequireRole.tsx` (§5.4). *(new)*

**Touched — wire `FactValue` into existing displays (replace ad-hoc value rendering):**
- `src/components/MarketDetailModal.tsx`, `src/components/GenericDetailModal.tsx`,
  `src/components/MarketCard.tsx`, `src/components/ExportSimulator.tsx`, `src/App.tsx` — route factual
  values (duty/tax/classification/laws) through `FactValue` so every one carries provenance + the flag.

**Deps to add:** `vite-plugin-pwa`, `workbox-window` (dev/runtime); `dexie`; `@tanstack/react-query`.
No new backend deps (endpoints are Phase 1 / Phase 4).

---

## 9. Test plan

**Offline (the exit metric):**
1. **App-shell offline boot** — build + `vite preview`, load once online, set DevTools Network → Offline,
   reload: app shell renders (no white screen), `offline.html` only on an un-cached route. *(SW precache)*
2. **Cached route offline** — visit an analysis online (mirrors to Dexie), go offline, navigate to it:
   renders from Dexie within LCP budget, `CachedDataBanner` shows "showing cached data from <time>" and is
   non-dismissible; every `FactValue` still shows source + "last verified". *(Exit metric: works offline.)*
3. **Offline write blocked** — offline, "New analysis"/refresh are disabled with the offline tooltip; no
   write hits a cache. *(No live RAG offline, §3.4.)*
4. **Cross-user leak** — user A caches data, logs out (Dexie + `api-get-v1` cache wiped), user B logs in on
   same device: B sees none of A's cached resources. *(§3.6.)*
5. **Update prompt** — ship a new build; client shows "Update available — Reload", not a silent swap. *(§2.5.)*

**Corrections e2e (the exit metric):**
6. **Flag → queue → approve → override** — as a user, flag a duty value via `FlagWrongDialog` (online):
   `POST /api/v1/corrections` returns `201 pending`. As an expert, open `/admin/corrections`: the flag
   appears with the current-vs-proposed diff. Approve it (`PATCH … status=approved`). Re-fetch the value as
   the original user: the **approved override is now served** (provenance source = `expert_override`,
   precedence per §3.3). *(Exit metric: corrections loop live.)*
7. **Offline flag → replay** — flag a value offline: queued in `pendingFlags`; reconnect: `useOnlineSync`
   drains it, idempotency-key prevents a duplicate on double-replay; row becomes `synced`. *(§3.5/§3.7.)*
8. **Reject path** — reject with reason → row leaves the pending queue; value unchanged. Double-approve →
   `409 CONFLICT` handled gracefully. *(§6.3.)*
9. **RBAC** — a `user`-role account cannot see `/admin/corrections` (UI hidden) and `GET/PATCH` admin
   endpoints return `403 PERMISSION_DENIED` even when called directly. *(§5.4 — server-truth.)*

**Usage dashboard:**
10. **Quota states** — render `under` (<80%), `near` (≥80%, amber + upgrade), `over` (≥100%, red + upgrade),
    `unlimited` (Business). Offline → "as of <date>" snapshot + banner. Phase-4 endpoint absent → empty state. *(§4.)*

**Performance / a11y (CI gates — Osmani):**
11. **Bundle budget** — initial JS ≤170KB gzip; `/admin/corrections`, `/account/usage`, jspdf/d3/maps are
    separate lazy chunks. Lighthouse: LCP<2.5s, INP<200ms, CLS<0.1. *(§ADR-013.)*
12. **A11y** — keyboard reach the flag button + operate the dialog (focus-trap, ESC) and queue rows;
    `aria-live` banners; labeled progressbars; axe clean (AA); `prefers-reduced-motion` honored.

**Gates (BUILD_PLAN §11):** ships only past `security-engineer` (no client-trusted authz, no cross-user
cache leak, safe markdown render) + `qa-tester` (above e2e green); correction-queue domain copy/flow signed
off by `trade-customs-expert`.
