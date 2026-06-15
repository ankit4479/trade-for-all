# Phase 2 — Smooth UX (feels instant) — Tech Spec

> **Owning skills:** `frontend-engineer` (Osmani — performance is a feature) lead, co-authored with
> `backend-engineer` (Kleppmann/DHH — SSE + pg-boss) and `ui-ux-designer` (Saarinen/Linear — craft, all states).
> **Status:** v1 (2026-06-09). Authored against `.ai/specs/00-foundation.md` (the SINGLE SOURCE OF TRUTH) and
> `.ai/BUILD_PLAN.md` §4 (all 6 perceived-performance points), §12 Phase-2 exit metric.
> **Spec-index id:** row 2 (`03-phase2-smooth-ux.md` in foundation §6); this file is the detailed expansion.
> **Depends on (do NOT re-decide here):** ADR-001 (Express 5), ADR-002 (pg-boss), ADR-010 (SSE),
> ADR-011 (zod), ADR-013 (React+Vite, code-split, latency budgets), schema §2 (`analysis_jobs`, `events`),
> API conventions §3 (envelopes §3.3/§3.4, designed-unknown §3.5, SSE contract §3.8), provenance types §4.

---

## 0. Goal + exit metric

**Goal (BUILD_PLAN §4):** the product *feels instant* even though a deep multi-market analysis fires 15–30+
LLM calls (today: `analyzeProduct` → one blocking call for 7 markets, then `MarketDetailModal.fetchMarketDetails`
fires a 2-step tool+synthesis call **per market**, blocking behind a single `<Loader2>` spinner — see
`src/components/MarketDetailModal.tsx:384` and `src/services/gemini.ts:581`). We replace every blocking spinner
with **stream-as-it-lands** rendering, a **durable async job** that survives navigation, **pre-warmed caches**,
**cached-first revalidation**, **CI-enforced latency budgets**, and **graceful degradation**.

**Exit metric (BUILD_PLAN §12 / top-level scoreboard §0):**

| Metric | Target | How measured (§9 test plan) |
|---|---|---|
| First paint | < 1.5s | Lighthouse CI (FCP) |
| First *useful* analysis content streamed | **< 3s** | `events.type='perf'` `first_section_ms` percentile from the SSE stream |
| Full deep analysis | **p95 < 30s** | `events` `job_complete_ms` p95 over 7-day window |
| LCP | **< 2.5s** | Lighthouse CI assertion (blocks merge) |
| INP | < 200ms | Lighthouse CI + field RUM |
| Initial JS (gzip) | ≤ 170 KB | `bundlesize` / Lighthouse CI `resource-summary` (blocks merge) |

These are **gates**: CI fails the merge if the synthetic budgets regress; the runtime metrics are tracked SLOs
on the COGS/perf dashboard (`devops-engineer`, BUILD_PLAN §9).

---

## 1. Architecture at a glance (what changes)

```
Browser (React + Vite, TanStack Query)
  POST /api/v1/analysis            ─────────────►  create analysis_job (queued), enqueue pg-boss, return {jobId}
  GET  /api/v1/jobs/:id/stream (SSE) ◄───────────  worker emits section-start / section-fill / done / error
        │ EventSource auto-reconnect; jobId persisted in URL (?job=) + IndexedDB
        │ on reconnect → server replays from analysis_jobs.partial_result, then live tail
        ▼
  IndexedDB (Dexie)  ← cached-first render of last-known job result (revalidate in bg)

Server (Express 5)
  routes/analysis.ts  → start job (idempotent), read job snapshot
  routes/jobs.ts      → SSE subscribe (replay + live), JSON status poll fallback
  services/jobBus.ts  → in-process EventEmitter fan-out (worker → SSE handlers in same proc;
                         cross-proc via pg-boss `publish`/LISTEN-NOTIFY, §3.4)
worker.ts (pg-boss, ADR-002)
  jobs/deepAnalysis.ts  → orchestrates the per-market fan-out; on each section landed:
                          UPDATE analysis_jobs.partial_result + publish a stream event
  jobs/prewarm.ts       → scheduled: pre-compute top-N popular HS routes from events table
```

Single deployable, single Postgres (ADR-002). The worker is the **same codebase, second entrypoint**
(`server/worker.ts`, foundation §5.1). No Redis, no WebSocket (ADR-010).

---

## 2. SSE streaming architecture

### 2.1 Wire contract (extends foundation §3.8)

`GET /api/v1/jobs/:id/stream` → `Content-Type: text/event-stream`. Auth: Firebase bearer (foundation §3.2);
RLS ensures the job belongs to the caller. Heartbeat comment `:\n\n` every 15s (ADR-010). Each SSE message:
`event: <type>\nid: <seq>\ndata: <json>\n\n`. The `id:` is a monotonic per-job sequence so a reconnecting
`EventSource` sends `Last-Event-ID` and the server replays only what was missed.

**Event types + payload shapes** (a deep analysis is a tree of *markets* × *sections*):

```typescript
// shared/streaming.ts — imported by server AND src (keep in sync with §2 schema + §4 provenance)
import type { Provenance, Freshness, Resolved } from './provenance';

/** Section ids match the analysis UI panels (MarketDetailModal tabs). */
export type SectionId =
  | 'overview'        // greenMarkets/yellowMarkets/redMarkets summary (the analyzeProduct result)
  | 'duty_tax'        // simulationParams — HARD numbers (authoritative API, never LLM, §3.1)
  | 'trade_laws'      // regulations + links
  | 'compliance'      // certifications / licenses
  | 'logistics'       // modes, forwarders
  | 'roadmap'         // execution roadmap
  | 'pulse';          // trade pulse (news/sanctions)

export interface StreamEnvelope { jobId: string; seq: number; ts: string; }

/** A market × section unit is starting (render its skeleton). */
export interface SectionStart extends StreamEnvelope {
  market: string;            // destination country (e.g. 'Germany') — '' for the overview
  section: SectionId;
  label: string;             // human label for the skeleton header
}

/** A unit landed (replace skeleton with content). `value` is the §3.5 Resolved<T> shape:
 *  known | low_confidence | sources_disagree | unavailable — never blank, never guessed. */
export interface SectionFill<T = unknown> extends StreamEnvelope {
  market: string;
  section: SectionId;
  value: Resolved<T>;
  provenance: Provenance;    // source + confidence band + citationVerified (§4)
  freshness: Freshness;      // "last verified: <date>" + isStale (§4)
}

/** Whole job finished; `degraded` flags partial/cached delivery (§7 graceful degradation). */
export interface JobDone extends StreamEnvelope {
  status: 'done';
  filledSections: number;
  totalSections: number;
  degraded: boolean;         // true if any section served cached/partial due to breaker/exhaustion
}

/** Fatal job error (rare — most failures degrade to a section 'unavailable', not a job error). */
export interface JobError extends StreamEnvelope {
  status: 'failed';
  code: 'UPSTREAM_UNAVAILABLE' | 'COST_CIRCUIT_OPEN' | 'INTERNAL';
  message: string;           // safe to show (foundation §3.4)
}

/** Lifecycle ticks (queued→running→streaming) for the progress UI. */
export interface JobStatus extends StreamEnvelope {
  status: 'queued' | 'running' | 'streaming';
}

export type StreamEvent =
  | ({ type: 'status' } & JobStatus)
  | ({ type: 'section-start' } & SectionStart)
  | ({ type: 'section-fill' } & SectionFill)
  | ({ type: 'done' } & JobDone)
  | ({ type: 'error' } & JobError);
```

**Ordering guarantee:** `status` → N×(`section-start` … later `section-fill`) → `done`. `section-start`
events for *all* planned units are emitted up-front (within ~300ms) so the UI can paint the full skeleton
grid instantly; fills arrive as each market/section completes. **First useful content** = the first
`section-fill` (the overview lands first because it's one cheap call), which is why <3s is achievable even
though the full fan-out takes ~30s.

### 2.2 Server: SSE handler (`server/routes/jobs.ts`)

Real Express 5 handler. Pulls from the in-process `jobBus` (live tail) and from `analysis_jobs.partial_result`
(replay on connect/reconnect). Cross-process delivery (worker proc → API proc) uses pg-boss `publish` bridged
into the same `jobBus` (§2.4).

```typescript
// server/routes/jobs.ts
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { withUserTx } from '../db/rls';
import { analysisJobs } from '../db/schema';
import { eq } from 'drizzle-orm';
import { jobBus } from '../services/jobBus';
import type { StreamEvent } from '../../shared/streaming';

export const jobsRouter = Router();

const HEARTBEAT_MS = 15_000;

jobsRouter.get('/jobs/:id/stream', requireAuth, async (req, res) => {
  const jobId = req.params.id;
  const { userId, role } = req.auth;

  // Ownership + load the current snapshot (RLS-scoped).
  const job = await withUserTx({ userId, role }, (tx) =>
    tx.query.analysisJobs.findFirst({ where: eq(analysisJobs.id, jobId) }),
  );
  if (!job) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Job not found', requestId: req.id } });

  // SSE headers. Disable proxy buffering (nginx) + compression for this response.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  let lastSent = Number(req.headers['last-event-id'] ?? 0);

  const send = (ev: StreamEvent) => {
    if (ev.seq <= lastSent) return;            // dedupe on replay/reconnect
    lastSent = ev.seq;
    res.write(`event: ${ev.type}\nid: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`);
  };

  // 1) REPLAY: rebuild the event log from the persisted partial_result so a reconnecting
  //    client (navigation, network drop) catches up before the live tail.
  for (const ev of rebuildEvents(job)) send(ev);

  // 2) If the job already finished while we were away, end immediately.
  if (job.status === 'done' || job.status === 'failed') {
    send(terminalEvent(job));
    return res.end();
  }

  // 3) LIVE TAIL: subscribe to the job bus for new events.
  const onEvent = (ev: StreamEvent) => {
    send(ev);
    if (ev.type === 'done' || ev.type === 'error') cleanup();
  };
  jobBus.on(jobId, onEvent);

  const heartbeat = setInterval(() => res.write(`:\n\n`), HEARTBEAT_MS);

  function cleanup() {
    clearInterval(heartbeat);
    jobBus.off(jobId, onEvent);
    if (!res.writableEnded) res.end();
  }
  req.on('close', cleanup);   // client navigated away / EventSource closed
});

/** Deterministically derive the event log (status + section-start + section-fill) from the
 *  persisted job snapshot. Sequence numbers are stable so Last-Event-ID dedupe works. */
function rebuildEvents(job: typeof analysisJobs.$inferSelect): StreamEvent[] {
  const log: StreamEvent[] = [];
  const partial = (job.partialResult ?? {}) as Record<string, any>;
  let seq = 0;
  const ts = job.updatedAt.toISOString();
  log.push({ type: 'status', jobId: job.id, seq: ++seq, ts, status: job.status as any });
  for (const unit of plannedUnits(job.input)) {       // deterministic plan from the job input
    log.push({ type: 'section-start', jobId: job.id, seq: ++seq, ts, market: unit.market, section: unit.section, label: unit.label });
    const filled = partial[`${unit.market}:${unit.section}`];
    if (filled) log.push({ type: 'section-fill', jobId: job.id, seq: ++seq, ts, ...filled });
  }
  return log;
}
```

> **Why replay from `partial_result` and not an event table:** ADR-010 says "server replays from
> `analysis_jobs.partialResult`". The worker writes each landed section into `partial_result`
> keyed `"<market>:<section>"`; the deterministic `plannedUnits(input)` plan lets us re-derive stable seq
> numbers without a separate append-only event log. (If we later need exactly-ordered cross-process replay
> we add an `analysis_job_events` table — out of scope for Phase 2.)

### 2.3 Worker: how the multi-market analysis emits each section as it lands (`server/jobs/deepAnalysis.ts`)

This is the heart of "stream, don't stall". The existing blocking calls (`analyzeProduct`,
`fetchMarketDetails`) move server-side into the worker; each completion **persists + publishes** instead of
returning at the end.

```typescript
// server/jobs/deepAnalysis.ts — pg-boss handler (registered in server/worker.ts)
import { withServiceTx } from '../db/rls';
import { analysisJobs } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import { publishStream } from '../services/jobBus';
import { runOverview, runMarketSection } from '../services/analysis/pipeline';
import { resolveAndMeasure } from '../services/provenance';   // §3.5 Resolved + §4 freshness
import type { SectionId, StreamEvent } from '../../shared/streaming';

interface DeepAnalysisInput { jobId: string; userId: string; query: string; hsCode: string; origin: string; }

const PER_MARKET_SECTIONS: SectionId[] = ['duty_tax', 'trade_laws', 'compliance', 'logistics', 'roadmap', 'pulse'];

export async function handleDeepAnalysis({ data }: { data: DeepAnalysisInput }) {
  const { jobId, userId } = data;
  let seq = 0;
  const emit = async (partial: Omit<StreamEvent, 'jobId' | 'seq' | 'ts'>) => {
    const ev = { ...partial, jobId, seq: ++seq, ts: new Date().toISOString() } as StreamEvent;
    await publishStream(jobId, ev);   // fan-out to SSE handlers (in-proc + cross-proc, §2.4)
  };

  await setStatus(jobId, 'running');
  await emit({ type: 'status', status: 'running' } as any);

  // ── Overview first: ONE cheap call → first useful content < 3s ───────────────────────────
  await emit({ type: 'section-start', market: '', section: 'overview', label: 'Market overview' } as any);
  const overview = await runOverview(data);                 // replaces analyzeProduct()
  const markets = [...overview.greenMarkets, ...overview.yellowMarkets].map((m) => m.country);
  await persistSection(jobId, '', 'overview', overview);
  await emit({ type: 'section-fill', market: '', section: 'overview', ...overview.streamPayload } as any);
  await setStatus(jobId, 'streaming');

  // ── Announce the full skeleton grid up-front so the UI paints all placeholders instantly ──
  for (const market of markets)
    for (const section of PER_MARKET_SECTIONS)
      await emit({ type: 'section-start', market, section, label: `${market} · ${section}` } as any);

  // ── Fan out per market × section; emit each as it lands (bounded concurrency = 4) ─────────
  let degraded = false, filled = 0;
  const units = markets.flatMap((m) => PER_MARKET_SECTIONS.map((s) => ({ market: m, section: s })));
  await mapWithConcurrency(units, 4, async ({ market, section }) => {
    try {
      const raw = await runMarketSection(data, market, section);     // wraps fetchMarketDetails pieces
      const resolved = resolveAndMeasure(section, raw);              // §3.5 + §4 (provenance/freshness)
      await persistSection(jobId, market, section, resolved.payload);
      await emit({ type: 'section-fill', market, section, ...resolved.payload } as any);
      if (resolved.payload.value.state !== 'known') degraded = true;
    } catch (err) {
      // Per-section degradation: never fail the whole job for one section (§7).
      degraded = true;
      const fallback = await loadCachedOrUnavailable(data, market, section);  // cached or {state:'unavailable'}
      await persistSection(jobId, market, section, fallback);
      await emit({ type: 'section-fill', market, section, ...fallback } as any);
    } finally {
      filled++;
    }
  });

  await setStatus(jobId, 'done');
  await emit({ type: 'done', status: 'done', filledSections: filled, totalSections: units.length + 1, degraded } as any);
}

async function persistSection(jobId: string, market: string, section: SectionId, payload: unknown) {
  await withServiceTx((tx) =>
    tx.update(analysisJobs)
      .set({
        partialResult: sql`jsonb_set(coalesce(${analysisJobs.partialResult}, '{}'::jsonb),
                                     ${`{${market}:${section}}`}, ${JSON.stringify(payload)}::jsonb, true)`,
        updatedAt: new Date(),
      })
      .where(eq(analysisJobs.id, jobId)),
  );
}
async function setStatus(jobId: string, status: string) {
  await withServiceTx((tx) => tx.update(analysisJobs).set({ status: status as any, updatedAt: new Date() }).where(eq(analysisJobs.id, jobId)));
}
```

> The worker uses a **service-role tx** (`withServiceTx`) writing `analysis_jobs` by id (the job row already
> carries `user_id`); it does not need per-request RLS since it operates out-of-band. Hard numbers in
> `duty_tax` come from the WTO/Comtrade proxy inside `runMarketSection`, never the LLM (foundation §3.1,
> BUILD_PLAN principle 3). The fabricated-data fallback (`gemini.ts:216–226`) is **deleted** — a failed
> section becomes `{ state: 'unavailable' }` (foundation §3.5), per BUILD_PLAN §3.6.

### 2.4 Cross-process fan-out (`server/services/jobBus.ts`)

The worker and the API run as separate Node processes (ADR-002 §5.1). The SSE handler lives in the API
process; the emitter lives in the worker. Bridge them over Postgres LISTEN/NOTIFY (one connection, no Redis —
honors "one datastore"):

```typescript
// server/services/jobBus.ts
import { EventEmitter } from 'node:events';
import { pgListener, pgNotify } from '../db/client';  // a dedicated LISTEN connection
import type { StreamEvent } from '../../shared/streaming';

export const jobBus = new EventEmitter();
jobBus.setMaxListeners(0);

// API process: receive NOTIFYs and re-emit locally so SSE handlers (subscribed by jobId) get them.
pgListener.on('notification', (msg) => {
  if (msg.channel !== 'job_stream' || !msg.payload) return;
  const ev = JSON.parse(msg.payload) as StreamEvent;
  jobBus.emit(ev.jobId, ev);
});
void pgListener.query('LISTEN job_stream');

// Worker process: persist already happened in deepAnalysis; here we just notify.
export async function publishStream(jobId: string, ev: StreamEvent): Promise<void> {
  jobBus.emit(jobId, ev);                       // same-proc (tests / single-proc dev)
  await pgNotify('job_stream', JSON.stringify(ev)); // cross-proc → API process SSE handlers
}
```

> NOTIFY payload limit is 8000 bytes; section fills can exceed that. **Rule:** if `JSON.stringify(ev).length`
> > 7000, NOTIFY a thin `{ jobId, seq, type, market, section }` pointer and the SSE handler re-reads the
> section from `analysis_jobs.partial_result`. (Most section payloads are small; the pointer path is the
> exception.)

### 2.5 Client: the stream hook (`src/hooks/useAnalysisStream.ts`)

Native `EventSource` can't set the `Authorization` header, so we use a **fetch + ReadableStream** SSE reader
(works with bearer auth) and reconnect with `Last-Event-ID`. State is a `Map<unitKey, UnitState>` driving the
skeleton→fill render. Cached-first hydration (§5) seeds the map from IndexedDB before the stream connects.

```typescript
// src/hooks/useAnalysisStream.ts
import { useEffect, useRef, useReducer, useCallback } from 'react';
import { getAuthToken } from '../services/authToken';
import { hydrateJob, persistJob } from '../services/jobCache';   // Dexie (§5)
import type { StreamEvent, SectionId, Resolved } from '../../shared/streaming';

export type UnitStatus = 'pending' | 'streaming' | 'filled' | 'stale' | 'error';
export interface UnitState { market: string; section: SectionId; label: string; status: UnitStatus; value?: Resolved<unknown>; provenance?: unknown; freshness?: unknown; }
interface StreamState { phase: 'connecting' | 'streaming' | 'done' | 'failed' | 'reconnecting'; units: Record<string, UnitState>; degraded: boolean; firstFillMs?: number; }

const key = (m: string, s: string) => `${m}:${s}`;

function reducer(state: StreamState, ev: StreamEvent | { type: '__local'; phase: StreamState['phase'] }): StreamState {
  switch (ev.type) {
    case '__local': return { ...state, phase: ev.phase };
    case 'status':  return { ...state, phase: ev.status === 'queued' ? 'connecting' : 'streaming' };
    case 'section-start': {
      const k = key(ev.market, ev.section);
      const prev = state.units[k];
      // Cached-first: keep a hydrated value but mark it 'stale' until the fresh fill lands (§5).
      return { ...state, units: { ...state.units, [k]: { market: ev.market, section: ev.section, label: ev.label, status: prev?.value ? 'stale' : 'pending', value: prev?.value } } };
    }
    case 'section-fill': {
      const k = key(ev.market, ev.section);
      return { ...state, firstFillMs: state.firstFillMs ?? performance.now(), units: { ...state.units, [k]: { ...state.units[k], status: 'filled', value: ev.value, provenance: ev.provenance, freshness: ev.freshness } } };
    }
    case 'done':  return { ...state, phase: 'done', degraded: ev.degraded };
    case 'error': return { ...state, phase: 'failed', degraded: true };
    default:      return state;
  }
}

export function useAnalysisStream(jobId: string | null) {
  const [state, dispatch] = useReducer(reducer, { phase: 'connecting', units: {}, degraded: false });
  const lastSeq = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const retry = useRef(0);
  const t0 = useRef<number>(performance.now());

  const connect = useCallback(async () => {
    if (!jobId) return;
    // Cached-first hydrate (instant paint of last-known) before the network is touched.
    const cached = await hydrateJob(jobId);
    if (cached) for (const u of cached.units) dispatch({ type: 'section-fill', ...u } as any);

    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    const token = await getAuthToken();

    const res = await fetch(`/api/v1/jobs/${jobId}/stream`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream', 'Last-Event-ID': String(lastSeq.current) },
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);

    dispatch({ type: '__local', phase: 'streaming' });
    retry.current = 0;
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      const frames = buf.split('\n\n'); buf = frames.pop() ?? '';
      for (const frame of frames) {
        if (frame.startsWith(':')) continue;                 // heartbeat
        const idLine = frame.split('\n').find((l) => l.startsWith('id:'));
        const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
        if (idLine) lastSeq.current = Number(idLine.slice(3).trim());
        if (!dataLine) continue;
        const ev = JSON.parse(dataLine.slice(5).trim()) as StreamEvent;
        dispatch(ev);
        if (ev.type === 'section-fill' && !state.firstFillMs)
          reportPerf('first_section_ms', performance.now() - t0.current, jobId);  // §9
        if (ev.type === 'done' || ev.type === 'error') { persistJob(jobId, ev); return; }
      }
    }
    throw new Error('stream ended without done');             // unexpected close → reconnect
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    const run = async () => {
      try { await connect(); }
      catch (e) {
        if (!alive || abort.current?.signal.aborted) return;
        dispatch({ type: '__local', phase: 'reconnecting' });
        const delay = Math.min(1000 * 2 ** retry.current++, 15000) + Math.random() * 500; // backoff + jitter
        setTimeout(() => { if (alive) run(); }, delay);
      }
    };
    void run();
    return () => { alive = false; abort.current?.abort(); };
  }, [jobId, connect]);

  return state;
}
```

### 2.6 Skeleton → fill render pattern (`src/components/AnalysisStreamView.tsx`)

The view paints the full skeleton grid the instant `section-start` events arrive, then swaps each cell as its
`section-fill` lands. No layout shift (CLS<0.1, Osmani doctrine 2): skeletons reserve the exact final box size.

```tsx
// src/components/AnalysisStreamView.tsx
import { useAnalysisStream, type UnitState } from '../hooks/useAnalysisStream';
import { SectionSkeleton } from './ui/SectionSkeleton';
import { SectionCard } from './SectionCard';            // renders Resolved<T> + provenance/freshness stamp
import { DegradedBanner, ReconnectBanner } from './ui/StatusBanners';

export function AnalysisStreamView({ jobId }: { jobId: string }) {
  const { phase, units, degraded } = useAnalysisStream(jobId);
  const cells = Object.values(units);

  return (
    <section aria-busy={phase === 'streaming'} aria-live="polite">
      {phase === 'reconnecting' && <ReconnectBanner />}
      {degraded && <DegradedBanner />}                  {/* "Showing cached / partial — try again" (§7) */}
      <div className="grid gap-4 md:grid-cols-2">
        {cells.map((u) => <Cell key={`${u.market}:${u.section}`} unit={u} />)}
      </div>
    </section>
  );
}

function Cell({ unit }: { unit: UnitState }) {
  switch (unit.status) {
    case 'pending':
    case 'streaming':
      return <SectionSkeleton label={unit.label} />;         // shimmering placeholder, fixed height
    case 'stale':
      return <SectionCard unit={unit} stale />;              // cached value, dimmed + "revalidating…" (§5)
    case 'error':
      return <SectionCard unit={unit} errored />;           // "data unavailable — retry" (§7) — never a dead spinner
    case 'filled':
      return <SectionCard unit={unit} />;                   // shows source URL + confidence band + "last verified" (§4)
  }
}
```

---

## 3. Async job queue for long ops (pg-boss, ADR-002)

### 3.1 Lifecycle (foundation `analysis_jobs`, schema §2)

```
POST /api/v1/analysis ──► row status='queued'  +  pg-boss send('deep-analysis', {jobId,...})
                          worker picks up      ──► status='running'   (status SSE tick)
                          overview landed      ──► status='streaming' (first section-fill)
                          all units settled    ──► status='done'  (result snapshot in partial_result)
                          fatal                ──► status='failed' (error column; SSE 'error')
```

Survives navigation/timeout because **state lives in Postgres**, not the connection: the client re-subscribes
by `jobId` (in the URL + IndexedDB) and the SSE handler replays from `partial_result` (§2.2).

### 3.2 Start endpoint (`server/routes/analysis.ts`) — idempotent (ADR-014)

```typescript
// server/routes/analysis.ts
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { enforceQuota } from '../middleware/rbac';      // meters deep_analyses (BUILD_PLAN §8)
import { costBreaker } from '../middleware/costBreaker'; // §7 / BUILD_PLAN §9
import { withUserTx } from '../db/rls';
import { analysisJobs } from '../db/schema';
import { and, eq } from 'drizzle-orm';
import { boss } from '../services/queue';
import { ok } from '../http/envelope';

export const analysisRouter = Router();

const StartBody = z.object({ query: z.string().min(2).max(500), hsCode: z.string().min(2).max(12), origin: z.string().length(2) });

analysisRouter.post('/analysis', requireAuth, costBreaker, enforceQuota('deep_analyses'),
  validate({ body: StartBody }), async (req, res) => {
    const { userId, role } = req.auth;
    const idempotencyKey = req.header('Idempotency-Key') ?? null;

    const job = await withUserTx({ userId, role }, async (tx) => {
      if (idempotencyKey) {                              // replay → return existing job (ADR-014)
        const existing = await tx.query.analysisJobs.findFirst({
          where: and(eq(analysisJobs.userId, userId), eq(analysisJobs.idempotencyKey, idempotencyKey)),
        });
        if (existing) return existing;
      }
      const [row] = await tx.insert(analysisJobs).values({
        userId, kind: 'deep_analysis', status: 'queued',
        input: { query: req.body.query, hsCode: req.body.hsCode, origin: req.body.origin },
        idempotencyKey,
      }).returning();
      return row;
    });

    // Enqueue AFTER commit; pg-boss singletonKey dedupes double-submits within the window.
    await boss.send('deep-analysis', { jobId: job.id, userId, ...job.input },
      { singletonKey: job.id, retryLimit: 2, expireInMinutes: 5 });

    res.status(201).json(ok({ jobId: job.id, status: job.status },
      { requestId: req.id }));
  });

// JSON snapshot (poll fallback when SSE is blocked by a proxy, and for the dashboard "resume" list).
analysisRouter.get('/analysis/:id', requireAuth, async (req, res) => {
  const { userId, role } = req.auth;
  const job = await withUserTx({ userId, role }, (tx) =>
    tx.query.analysisJobs.findFirst({ where: eq(analysisJobs.id, req.params.id) }));
  if (!job) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Job not found', requestId: req.id } });
  res.json(ok({ id: job.id, status: job.status, partial: job.partialResult, result: job.result, error: job.error }, { requestId: req.id }));
});
```

### 3.3 Worker registration (`server/worker.ts`)

```typescript
// server/worker.ts — second entrypoint (ADR-002 §5.1), shares server/db + services
import 'dotenv/config';
import { boss } from './services/queue';
import { handleDeepAnalysis } from './jobs/deepAnalysis';
import { handlePrewarm } from './jobs/prewarm';

async function main() {
  await boss.start();
  await boss.work('deep-analysis', { teamSize: 5, teamConcurrency: 5 }, handleDeepAnalysis);
  // Cache pre-warming on a schedule (§4). pg-boss cron (ADR-002 supports scheduled jobs).
  await boss.schedule('prewarm-popular-routes', '0 */6 * * *');   // every 6h
  await boss.work('prewarm-popular-routes', handlePrewarm);
  console.log('[worker] up: deep-analysis + prewarm');
}
main().catch((e) => { console.error(e); process.exit(1); });
```

```typescript
// server/services/queue.ts
import PgBoss from 'pg-boss';
export const boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, schema: 'pgboss' });
```

### 3.4 Surviving navigation / timeout — client resume

- On `POST /api/v1/analysis` success the client writes `?job=<jobId>` into the URL (`history.replaceState`)
  and stores `{ jobId, createdAt, input }` in IndexedDB (`jobCache`).
- On app load, `useResumableJob()` reads `?job=` (or the most recent un-finished job in IndexedDB) and mounts
  `<AnalysisStreamView jobId>` → the hook reconnects, replays `partial_result`, and continues live.
- A timeout/disconnect never loses work: the worker keeps running independently; the SSE just reconnects with
  `Last-Event-ID` (§2.5 backoff loop) and the server replays the gap (§2.2).
- The dashboard shows a "Resume analysis" chip for any job whose IndexedDB record is `< 1h` old and not `done`.

```typescript
// src/hooks/useResumableJob.ts
export function useResumableJob() {
  const [jobId, setJobId] = useState<string | null>(() => new URLSearchParams(location.search).get('job'));
  const start = useCallback(async (input: AnalysisInput) => {
    const idem = crypto.randomUUID();
    const { data } = await api.post('/analysis', input, { headers: { 'Idempotency-Key': idem } });
    history.replaceState(null, '', `?job=${data.jobId}`);
    await persistJobMeta(data.jobId, input);
    setJobId(data.jobId);
  }, []);
  return { jobId, start };
}
```

---

## 4. Cache pre-warming (`server/jobs/prewarm.ts`)

**Goal (BUILD_PLAN §4.3):** pre-compute the top-N popular HS routes so the *first* user of a route isn't slow,
pushing shared-cache hit-rate toward the 80% margin target. Scheduled every 6h (§3.3).

**"Popular" is determined from the `events` table** (schema §2: `type` includes `'cache_miss'` / `'funnel'`).
We rank `(hs_code, origin, destination)` routes by recent miss + request frequency, exclude routes already
fresh in `hs_code_data` (foundation §4 `computeFreshness`), and pre-run the analysis pipeline for the top N.

```typescript
// server/jobs/prewarm.ts
import { withServiceTx } from '../db/rls';
import { sql } from 'drizzle-orm';
import { runMarketSection } from '../services/analysis/pipeline';
import { upsertCachedSection } from '../services/cache';

const TOP_N = 50;

export async function handlePrewarm() {
  // Rank routes by demand over the last 14 days from the analytics events stream.
  const routes = await withServiceTx((tx) => tx.execute(sql`
    SELECT payload->>'hsCode' AS hs_code,
           payload->>'origin' AS origin,
           payload->>'destination' AS destination,
           count(*) AS hits
    FROM events
    WHERE type IN ('cache_miss','funnel')
      AND created_at > now() - interval '14 days'
      AND payload ? 'hsCode' AND payload ? 'destination'
    GROUP BY 1,2,3
    ORDER BY hits DESC
    LIMIT ${TOP_N}
  `));

  for (const r of routes.rows as any[]) {
    // Skip routes already fresh (don't burn Gemini budget re-warming fresh cache).
    if (await isFresh(r.hs_code, r.origin, r.destination)) continue;
    for (const section of ['duty_tax', 'trade_laws', 'compliance', 'logistics'] as const) {
      try {
        const raw = await runMarketSection({ hsCode: r.hs_code, origin: r.origin } as any, r.destination, section);
        await upsertCachedSection(r, section, raw);        // writes hs_code_data w/ provenance (foundation §2)
      } catch { /* prewarm is best-effort; never throws into the queue */ }
    }
  }
}
```

> Pre-warm runs through the **same** pipeline + cost-breaker as live traffic (BUILD_PLAN §9): if the breaker is
> open it short-circuits, so a miss-storm never competes with paying users for Gemini budget. `TOP_N` and the
> cron cadence are tunable knobs surfaced on the COGS dashboard.

---

## 5. Optimistic + cached-first UI (BUILD_PLAN §4.4)

**Principle:** render last-known instantly, then revalidate. Two layers:

1. **Server state (TanStack Query, stale-while-revalidate)** for everything that's a plain GET (overview list,
   job snapshot, account/quota). `staleTime` per data-tier mirrors foundation §4 TTLs (e.g. duty/tariff
   `staleTime: 12mo`, pulse `staleTime: 1h`). Query returns cached data immediately and revalidates in the
   background — the Osmani/`frontend-engineer` server-state rule.
2. **IndexedDB (Dexie)** for the streamed analysis result (the SSE payload isn't a normal query). `jobCache`
   stores the last completed job's `units[]`. `useAnalysisStream` (§2.5) hydrates from it before connecting, so
   a returning user sees the full last-known analysis **instantly**, marked `stale`, while the fresh stream
   revalidates cell-by-cell.

**The loading/stale/fresh state machine** (per section cell, drives `SectionCard`):

```
            section-start (no cache)        section-fill
  ┌────────┐ ───────────────────────► ┌──────────┐ ─────────────► ┌────────┐
  │ pending│                          │ streaming│                │ filled │
  └────────┘                          └──────────┘                └────────┘
       ▲                                    │ fetch error / breaker     │
       │ hydrate(IndexedDB)                 ▼                           │ freshness.isStale (§4)
  ┌────────┐  section-start (cache hit)  ┌──────┐                       ▼
  │ stale  │ ◄────────────────────────  │ error│                  ┌────────┐
  └────────┘  (show cached, dimmed,      └──────┘                  │ stale  │ → background revalidate
              "revalidating…")           "unavailable — retry"     └────────┘
```

- **stale** = we have a value (from IndexedDB or an expired-TTL cache) and are revalidating → render it dimmed
  with a "revalidating…" pill + the existing "last verified: <date>" stamp (§4) — **never a blank skeleton when
  we have something to show** (Linear: speed is a feature).
- **fresh/filled** = current value with provenance + freshness stamp.
- Transition stale→filled is a crossfade respecting `prefers-reduced-motion` (ui-ux-designer AA req).

---

## 6. Latency budgets in CI (Osmani doctrine 1; ADR-013)

**Concrete budgets (BUILD_PLAN §4.5 / §0):** initial JS ≤ 170 KB gzip, LCP < 2.5s, INP < 200ms, CLS < 0.1,
FCP < 1.5s. Enforced two ways, **both block merge**:

### 6.1 Lighthouse CI (synthetic, blocks PR)

```jsonc
// lighthouserc.json
{
  "ci": {
    "collect": { "startServerCommand": "npm run preview", "url": ["http://localhost:4173/"], "numberOfRuns": 3 },
    "assert": {
      "assertions": {
        "categories:performance": ["error", { "minScore": 0.9 }],
        "largest-contentful-paint": ["error", { "maxNumericValue": 2500 }],
        "first-contentful-paint":   ["error", { "maxNumericValue": 1500 }],
        "cumulative-layout-shift":  ["error", { "maxNumericValue": 0.1 }],
        "interaction-to-next-paint":["error", { "maxNumericValue": 200 }],
        "total-byte-weight":        ["warn",  { "maxNumericValue": 1600000 }],
        "resource-summary:script:size": ["error", { "maxNumericValue": 174080 }]  // 170 KB initial JS
      }
    },
    "upload": { "target": "temporary-public-storage" }
  }
}
```

### 6.2 bundlesize gate (fast, per-chunk)

```jsonc
// package.json (add)
"bundlesize": [
  { "path": "dist/assets/index-*.js", "maxSize": "170 kB", "compression": "gzip" },
  { "path": "dist/assets/vendor-*.js", "maxSize": "120 kB", "compression": "gzip" }
]
```

### 6.3 CI wiring (`.github/workflows/perf.yml`)

```yaml
name: perf-budgets
on: [pull_request]
jobs:
  budgets:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run build
      - run: npx bundlesize                       # fails if any chunk over budget
      - run: npx @lhci/cli@0.13.x autorun         # fails on the assertions above
```
Make `perf-budgets` a **required status check** on the default branch (branch protection) so a regression
cannot merge.

### 6.4 Code-splitting + lazy-route plan for the *current* app

The app currently imports everything eagerly in `src/App.tsx` (44 KB) and ships heavy libs in the initial
bundle. Split aggressively (PRPL, Osmani doctrine 3):

| Module | Size driver | Action |
|---|---|---|
| `WorldMap.tsx` (32 KB) + `d3` + `topojson-client` + `@vis.gl/react-google-maps` | maps/visualization | `React.lazy()` — only load when the map view is shown; preconnect to maps host |
| `MarketDetailModal.tsx` (72 KB) | the whole deep-analysis UI | `React.lazy()` behind modal open; this is where `AnalysisStreamView` mounts |
| `DocumentGeneratorModal.tsx` + `jspdf` + `jspdf-autotable` | PDF export | `React.lazy()` + dynamic `import('jspdf')` only on "Generate document" click |
| `react-markdown` | LLM output rendering | dynamic import inside `SectionCard` (only when a markdown section renders) |
| `ProfilePage.tsx` (23 KB) | route | lazy route via `react-router-dom` (already a dep) |

```tsx
// src/App.tsx (sketch of the lazy boundaries)
const WorldMap = lazy(() => import('./components/WorldMap'));
const MarketDetailModal = lazy(() => import('./components/MarketDetailModal'));
const DocumentGeneratorModal = lazy(() => import('./components/DocumentGeneratorModal'));
const ProfilePage = lazy(() => import('./components/ProfilePage'));
// each wrapped in <Suspense fallback={<SectionSkeleton/>}> — skeleton, never a spinner
```

Vite manual chunks to keep the vendor split stable for the bundlesize gate:

```typescript
// vite.config.ts (add to build.rollupOptions.output.manualChunks)
manualChunks: {
  vendor: ['react', 'react-dom', 'react-router-dom'],
  viz: ['d3', 'topojson-client', '@vis.gl/react-google-maps'],
  pdf: ['jspdf', 'jspdf-autotable'],
  markdown: ['react-markdown'],
}
```
(Phase-0 already removed the `define` GEMINI key from `vite.config.ts` — ADR-013; nothing to re-add here.)

---

## 7. Graceful degradation (BUILD_PLAN §4.6)

**Principle:** on retry-exhaustion, `UPSTREAM_UNAVAILABLE`, or the cost circuit-breaker tripping
(`COST_CIRCUIT_OPEN`, foundation §3.4 / BUILD_PLAN §9), **serve cached/partial with a clear state — never a dead
spinner** (the anti-pattern both `frontend-engineer` and `ui-ux-designer` explicitly reject).

**Server behavior (per section, in `deepAnalysis.ts` §2.3):**
- A section that exhausts retries or hits the breaker → `loadCachedOrUnavailable()`:
  1. last-known fresh-or-stale value from `hs_code_data` → emit `section-fill` with
     `value.state ∈ {known(stale), low_confidence}` + `freshness.isStale = true`.
  2. nothing cached → emit `section-fill` with `value.state = 'unavailable'` (foundation §3.5). **Not** a
     job error — one bad section never kills the run.
- The job still reaches `done` with `degraded: true`; only a total inability to start the run yields `error`.

**Client component states (`SectionCard`):**

| State | Trigger | UI (Linear craft — clear, with a next action) |
|---|---|---|
| `filled` | fresh `section-fill`, `state='known'` | content + source URL + confidence band + "last verified: <date>" |
| `stale` | cached value, `freshness.isStale` or `degraded` | same content **dimmed** + amber "Showing cached data" pill + "Refresh" button |
| `low_confidence` | `state='low_confidence'` | partial content + "Limited data — verify" badge (never fabricate) |
| `sources_disagree` | `state='sources_disagree'` | served value + "Sources disagree" badge, both shown (foundation §3.3) |
| `unavailable` | `state='unavailable'` | "Data unavailable for this route — Try again" button (re-enqueues that section) |
| `reconnecting` | SSE drop (hook §2.5) | thin top banner "Reconnecting…"; existing cells stay visible (no full-screen spinner) |

Global banners: `<DegradedBanner>` ("Showing cached / partial results — some live data was unavailable.
Try again") and `<ReconnectBanner>`. The full-screen `<Loader2>` at `App.tsx:521` and the modal spinner at
`MarketDetailModal.tsx:535` are **removed** in favor of the skeleton grid (§2.6).

---

## 8. Component / state inventory

### 8.1 New / changed React components

| File | New? | Role / states |
|---|---|---|
| `src/components/AnalysisStreamView.tsx` | new | container: subscribes to the stream, paints skeleton grid, renders cells |
| `src/components/SectionCard.tsx` | new | renders one `Resolved<T>` unit: filled / stale / low_confidence / sources_disagree / unavailable / error; shows provenance + freshness stamp (§4) |
| `src/components/ui/SectionSkeleton.tsx` | new | Linear-grade shimmer placeholder, **fixed height** per section type (no CLS) |
| `src/components/ui/StatusBanners.tsx` | new | `DegradedBanner`, `ReconnectBanner`, `QuotaBanner` |
| `src/components/MarketDetailModal.tsx` | changed | replace the blocking `fetchMarketDetails`+`<Loader2>` (lines ~384–535) with `<AnalysisStreamView jobId>` |
| `src/App.tsx` | changed | start a job (not call `analyzeProduct` directly); lazy boundaries (§6.4); remove full-screen spinner (line 521) |

### 8.2 New hooks / services (client)

| File | Role |
|---|---|
| `src/hooks/useAnalysisStream.ts` | fetch-stream SSE reader, reducer-driven unit state, `Last-Event-ID` reconnect (§2.5) |
| `src/hooks/useResumableJob.ts` | start job (idempotent), persist `?job=` + IndexedDB, resume on load (§3.4) |
| `src/services/jobCache.ts` | Dexie store for last-known job units (cached-first hydrate, §5) |
| `src/services/authToken.ts` | returns the Firebase ID token for the bearer header (the stream can't use raw `EventSource`) |
| `src/services/perf.ts` | `reportPerf(metric, ms, jobId)` → `POST /api/v1/events` (§9 instrumentation) |
| `src/lib/queryClient.ts` | TanStack Query client with per-tier `staleTime` (§5) |

### 8.3 Loading-state design (Linear craft)

- **Skeletons, not spinners**, everywhere (Osmani doctrine 5 + ui-ux-designer anti-pattern). Each skeleton box
  matches the final card's dimensions → CLS≈0.
- **Progressive disclosure:** the overview cell fills first (one cheap call); per-market cells shimmer then
  fill in waves of 4 (worker concurrency). The user reads the overview while details stream.
- **Trust stamps** appear the moment a cell fills: source URL, confidence band color, "last verified: <date>"
  (foundation §4 — BUILD_PLAN §0 trust metric "100% sourced").
- `prefers-reduced-motion`: shimmer → static placeholder; crossfade → instant swap.
- Keyboard + AA: `aria-busy` on the container, `aria-live="polite"` so screen readers announce each landed
  section without flooding.

---

## 9. File-level change list + test plan

### 9.1 File-level change list

**Server (new):**
- `server/routes/analysis.ts` — start job (idempotent) + JSON snapshot (§3.2)
- `server/routes/jobs.ts` — SSE subscribe handler (§2.2)
- `server/services/jobBus.ts` — in-proc + LISTEN/NOTIFY fan-out (§2.4)
- `server/services/queue.ts` — pg-boss instance (§3.3)
- `server/worker.ts` — worker entrypoint: deep-analysis + prewarm registration (§3.3)
- `server/jobs/deepAnalysis.ts` — streaming orchestration of the per-market fan-out (§2.3)
- `server/jobs/prewarm.ts` — popular-route pre-warm (§4)
- `server/services/analysis/pipeline.ts` — `runOverview`, `runMarketSection` (the migrated, server-side,
  non-blocking versions of `analyzeProduct` / `fetchMarketDetails`; **delete** the fabricated fallback
  `gemini.ts:216–226`)
- `shared/streaming.ts` — `StreamEvent` union + `SectionId` (§2.1)

**Client (new):** all of §8.1 (new) + §8.2.

**Client (changed):**
- `src/App.tsx` — job-start flow, lazy boundaries, remove full-screen spinner
- `src/components/MarketDetailModal.tsx` — mount `AnalysisStreamView`, drop blocking fetch+spinner
- `src/services/gemini.ts` — client no longer calls Gemini directly; thin API client (Phase-0 already moved
  keys server-side; this phase removes the remaining direct `ai.models.generateContent` call sites from the
  client path)
- `vite.config.ts` — `manualChunks` (§6.4)

**CI / config (new):**
- `lighthouserc.json`, `.github/workflows/perf.yml`, `bundlesize` block in `package.json`

**Deps to add:** `pg-boss`, `dexie`, `@tanstack/react-query`; dev: `@lhci/cli`, `bundlesize`.

### 9.2 Test plan — measuring the exit metrics

**(a) First useful content < 3s** — instrumented end-to-end:
- Client `useAnalysisStream` calls `reportPerf('first_section_ms', performance.now() - t0)` when the first
  `section-fill` arrives (`t0` = job POST). `perf.ts` POSTs to `/api/v1/events` (`type='perf'`).
- Dashboard query: `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (payload->>'value')::numeric)
  FROM events WHERE type='perf' AND payload->>'metric'='first_section_ms'`. **Assert p50 and p95 < 3000ms.**
- Synthetic CI smoke: a Playwright test starts an analysis against a seeded cache and asserts the first
  `SectionCard[data-status="filled"]` appears within 3s (`await expect(cell).toBeVisible({ timeout: 3000 })`).

**(b) Deep p95 < 30s:**
- Worker stamps `events(type='perf', metric='job_complete_ms')` on `done` (now − created_at). Dashboard p95
  over a 7-day window; **alert if p95 > 30s** (devops SLO).
- Load test: `k6`/`autocannon` fires N concurrent analyses against a cold cache, asserting p95 completion and
  that the cost breaker degrades (not unbounded Gemini spend) under a miss-storm.

**(c) LCP < 2.5s / INP < 200ms / JS ≤ 170KB:** the CI `perf-budgets` job (§6.3) is the gate. Field RUM: a
small `web-vitals` reporter posts LCP/INP/CLS to `events(type='cwv')` for the real-user dashboard.

**(d) SSE correctness (unit/integration):**
- `jobs.ts` replay: create a job, write three sections into `partial_result`, connect with `Last-Event-ID: 2`,
  assert only `seq > 2` events are delivered, then a live `section-fill` appends.
- Reconnect: kill the fetch mid-stream, assert the hook reconnects with the right `Last-Event-ID` and the unit
  map is unchanged (no duplicate fills, no lost sections).
- Degradation: stub `runMarketSection` to throw for one market; assert that section emits `unavailable`/cached
  and the job still reaches `done` with `degraded:true` (no job `error`).

**(e) Cached-first:** with a populated `jobCache`, assert `AnalysisStreamView` paints filled (stale) cells on
mount **before** any network response, then transitions stale→filled on stream fills.

---

## 10. Cross-links

- Schema (`analysis_jobs`, `events`): foundation §2.
- API envelopes (`ok()`/`ApiError`), error codes (`UPSTREAM_UNAVAILABLE`, `COST_CIRCUIT_OPEN`, `QUOTA_EXCEEDED`),
  designed-unknown `Resolved<T>`, SSE contract: foundation §3.3–§3.5, §3.8.
- Provenance / freshness types (`Provenance`, `Freshness`, `computeFreshness`, confidence bands): foundation §4.
- ADRs: SSE (010), pg-boss (002), Express 5 (001), React+Vite+budgets (013), zod (011), idempotency (014).
- Upstream dependency: Phase 1 must have landed the shared cache + provenance write-back (so pre-warm and
  cached-first have something to read); Phase 2 does **not** re-implement retrieval/synthesis — it streams it.
