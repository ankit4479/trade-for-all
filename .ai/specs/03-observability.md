# 03 — Observability & Log Management Spec

> **Personas:** `data-engineer` (lead), `backend-engineer`, `architect`.
> **Status:** v1 (2026-06-15).
> **Scope:** How every process in Trade for All logs its activity — with enough structure
> that an LLM can read the logs, write SQL against them, and diagnose any issue without
> human interpretation. Covers the pipeline logger, the `pipeline_logs` DB table, the
> rate limiter design, and the parallel queue upgrade path.
>
> **Core principle:** Every debug session in this project is done by an LLM, not a human
> reading raw text. Logs must be LLM-friendly — structured, contextual, and queryable
> via SQL. "What caused the WTO loader to stall on chapter 09 last Tuesday?" must be
> answerable in one SQL query.

---

# 1. Architecture Decision Record — ADR-022

### ADR-022 — Logs are a **first-class DB table**, not files or stdout-only

- **Decision:** Every log entry emitted by a loader, API client, or pipeline process is
  written to BOTH:
  1. Console/stdout (pino, human-readable in dev, JSON in production)
  2. `pipeline_logs` table in our PostgreSQL database

- **Context:** The project's debugging model is LLM-first. When something goes wrong
  in a loader that ran for 2 hours overnight, a human cannot efficiently scan thousands
  of console lines. An LLM given a SQL interface can instantly answer:
  - "Which WTO calls returned 429 in the last run?"
  - "Which HS codes failed to upsert and why?"
  - "How long did chapter 09 take vs chapter 84?"
  - "Which ingestion run has the highest error rate?"

  File-based logs or stdout-only logs cannot be queried this way without external
  infrastructure (ELK, Datadog, etc.) that adds cost and complexity. Our own DB
  table costs nothing, is always available locally, and is directly queryable by
  the same Drizzle ORM the rest of the codebase uses.

- **Consequences:**
  - Every logger call is async — it writes to the DB in the background without
    blocking the main pipeline flow
  - The `pipeline_logs` table has a defined retention policy (90 days by default)
  - Log entries are structured JSON — every field is typed and indexed, not free text
  - The LLM debugging workflow: read `ingestion_runs` → find the run ID → query
    `pipeline_logs WHERE ingestion_run_id = ?` → full picture of what happened

---

# 2. The `pipeline_logs` Table

```typescript
export const logLevel = pgEnum('log_level', ['debug', 'info', 'warn', 'error']);

export const pipelineLogs = pgTable(
  'pipeline_logs',
  {
    id:              uuid('id').defaultRandom().primaryKey(),

    // — What process emitted this log —
    ingestionRunId:  uuid('ingestion_run_id').references(() => ingestionRuns.id), // ties all logs in one run together
    loaderName:      varchar('loader_name', { length: 64 }).notNull(),  // 'hs-codes' | 'wto-mfn' | 'wto-country'
    level:           logLevel('level').notNull(),

    // — What the log is about —
    message:         text('message').notNull(),                          // human-readable summary
    phase:           varchar('phase', { length: 64 }),                  // 'fetch' | 'transform' | 'upsert' | 'retry'
    tableAffected:   varchar('table_affected', { length: 64 }),         // 'hs_codes' | 'hs_mfn_duties' | etc.

    // — API call details (when log is about an external call) —
    apiName:         varchar('api_name', { length: 32 }),               // 'wto' | 'comtrade'
    apiUrl:          text('api_url'),                                    // sanitised — NO API key in URL
    httpStatus:      integer('http_status'),
    durationMs:      integer('duration_ms'),
    attemptNumber:   integer('attempt_number'),                         // 1 = first try, 2+ = retry

    // — Data context (what row/entity is being processed) —
    reporterCode:    varchar('reporter_code', { length: 8 }),           // 'US' | 'GB' | etc.
    partnerCode:     varchar('partner_code', { length: 8 }),
    hsCode:          varchar('hs_code', { length: 6 }),
    indicator:       varchar('indicator', { length: 16 }),              // 'HS_A_0010' | 'TP_A_0030' | etc.
    year:            integer('year'),

    // — Result —
    rowsAffected:    integer('rows_affected'),                          // rows upserted in this step
    errorCode:       varchar('error_code', { length: 32 }),             // 'rate_limited' | 'no_coverage' | 'timeout' | etc.
    errorDetail:     text('error_detail'),                              // full error message / stack (errors only)

    // — Extra structured context (anything that doesn't fit above) —
    meta:            jsonb('meta').$type<Record<string, unknown>>(),

    createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    runIdx:     index('pipeline_logs_run_idx').on(t.ingestionRunId, t.createdAt),
    levelIdx:   index('pipeline_logs_level_idx').on(t.level, t.createdAt),
    loaderIdx:  index('pipeline_logs_loader_idx').on(t.loaderName, t.createdAt),
    apiIdx:     index('pipeline_logs_api_idx').on(t.apiName, t.httpStatus),
    hsIdx:      index('pipeline_logs_hs_idx').on(t.hsCode, t.reporterCode),
    errorIdx:   index('pipeline_logs_error_idx').on(t.errorCode).where(sql`error_code IS NOT NULL`),
  }),
);
```

### Why each field exists

| Field | LLM diagnostic use |
|---|---|
| `ingestion_run_id` | "Show me every log from the run that failed last night" |
| `loader_name` | "Which loader is slowest?" |
| `phase` | "How many retries happened in the fetch phase vs upsert phase?" |
| `table_affected` | "Were any hs_mfn_duties rows skipped and why?" |
| `api_name` + `http_status` | "How many 429s did WTO return this week?" |
| `duration_ms` | "Which WTO call took longest? Is it a specific HS code?" |
| `attempt_number` | "How many calls needed more than 1 retry?" |
| `reporter_code` + `hs_code` | "Did chapter 09 for USA succeed?" |
| `indicator` | "Which indicator has the most no_coverage responses?" |
| `error_code` | "Classify all errors by type" |
| `rows_affected` | "Did any upsert write 0 rows? That's a bug." |

---

# 3. Rate Limiter Design

## Option A — Token Bucket (implemented now)

A single `RateLimitedClient` class per API. Enforces minimum spacing between calls,
retries on 429/5xx with exponential backoff, circuit-breaks after consecutive failures.

```
┌─────────────────────────────────────────────┐
│              RateLimitedClient               │
│                                              │
│  config: { minSpacingMs, maxRetries,        │
│            backoffBase, circuitThreshold }   │
│                                              │
│  call(url, opts)                             │
│    → enforce spacing (lastCallAt + minSpacing)│
│    → fetch with timeout                      │
│    → on 429/5xx: wait backoff, retry         │
│    → on success: log INFO to DB + console    │
│    → on final failure: log ERROR, throw      │
│    → circuit: N consecutive errors → pause  │
└─────────────────────────────────────────────┘
```

**Config per API:**
```typescript
WTO_CONFIG = {
  minSpacingMs:       1500,   // 1.5s between calls (tested live)
  maxRetries:         3,
  backoffBaseMs:      3000,   // 3s → 6s → 12s on successive retries
  circuitThreshold:   10,     // pause after 10 consecutive errors
  timeoutMs:          30000,
}

COMTRADE_CONFIG = {
  minSpacingMs:       500,    // 0.5s between calls (tested live at 0.5s = 0 errors)
  maxRetries:         3,
  backoffBaseMs:      2000,
  circuitThreshold:   10,
  timeoutMs:          45000,
}
```

**Every call logs:**
```json
{
  "level": "info",
  "phase": "fetch",
  "apiName": "wto",
  "apiUrl": "https://api.wto.org/timeseries/v1/data?i=HS_A_0010&r=840&pc=09&ps=2023",
  "httpStatus": 200,
  "durationMs": 1243,
  "attemptNumber": 1,
  "indicator": "HS_A_0010",
  "reporterCode": "US",
  "hsCode": "09",
  "year": 2023
}
```

## Option B — Parallel Queue (upgrade path, not built now)

When we need to run multiple loaders in parallel (e.g. load HS-4 for US while
loading HS-4 for GB simultaneously), a single `lastCallAt` variable is no longer
enough — two loaders would race each other and violate the spacing.

The upgrade: replace the spacing check with a **shared queue** backed by `pg-boss`
(already in our stack). Every API call becomes a job in the queue. A single worker
per API drains the queue at the safe rate, regardless of how many loaders are
enqueuing jobs.

```
┌──────────┐    enqueue    ┌─────────────┐    drain at    ┌──────────┐
│ Loader A │ ──────────→  │  pg-boss    │  1.5s/call  → │ WTO API  │
│ Loader B │ ──────────→  │  wto_queue  │               └──────────┘
│ Loader C │ ──────────→  └─────────────┘
└──────────┘
```

**When to upgrade:** When we start running HS-4 and HS-6 loaders in parallel, or
when we add on-demand resolver calls that must share the rate limit with background
batch jobs. Until then, Option A is sufficient.

---

# 4. The Logger Design

One shared `pino` instance. Two transports — console and DB — run in parallel.
The DB transport is non-blocking (fire-and-forget with a background queue).

```typescript
// server/loaders/_lib/logger.ts

import pino from 'pino';

// Console transport: human-readable in dev, JSON in production
const consoleLogger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});

// DB transport: structured insert into pipeline_logs
// Non-blocking — errors here never crash the loader
async function writeToDb(entry: LogEntry): Promise<void> { ... }

// The unified logger used by all loaders and clients
export function createLogger(loaderName: string, ingestionRunId: string) {
  return {
    info:  (msg: string, ctx?: LogContext) => log('info',  msg, ctx),
    warn:  (msg: string, ctx?: LogContext) => log('warn',  msg, ctx),
    error: (msg: string, ctx?: LogContext) => log('error', msg, ctx),
  };
  // Each call writes to console synchronously and DB asynchronously
}
```

---

# 5. Example LLM Diagnostic Queries

These are the queries an LLM would run to debug a loader run:

```sql
-- 1. What happened in the last run overall?
SELECT status, rows_upserted, rows_flagged, error, started_at, finished_at
FROM ingestion_runs ORDER BY started_at DESC LIMIT 5;

-- 2. All errors from that run
SELECT loader_name, phase, hs_code, reporter_code, indicator,
       error_code, error_detail, created_at
FROM pipeline_logs
WHERE ingestion_run_id = '<run-id>' AND level = 'error'
ORDER BY created_at;

-- 3. How many 429s did WTO return, and which HS codes triggered them?
SELECT hs_code, reporter_code, COUNT(*) as retries
FROM pipeline_logs
WHERE api_name = 'wto' AND http_status = 429
GROUP BY hs_code, reporter_code ORDER BY retries DESC;

-- 4. Which indicator has the most no_coverage (204) responses?
SELECT indicator, reporter_code, COUNT(*) as no_coverage_count
FROM pipeline_logs
WHERE error_code = 'no_coverage'
GROUP BY indicator, reporter_code ORDER BY no_coverage_count DESC;

-- 5. Average call duration per API
SELECT api_name, AVG(duration_ms) as avg_ms, MAX(duration_ms) as max_ms
FROM pipeline_logs
WHERE phase = 'fetch' AND http_status = 200
GROUP BY api_name;

-- 6. Did chapter 09 for USA complete successfully?
SELECT phase, http_status, duration_ms, rows_affected, error_code
FROM pipeline_logs
WHERE hs_code = '09' AND reporter_code = 'US'
ORDER BY created_at;
```

---

# 6. Retention Policy

- `pipeline_logs` rows older than **90 days** are deleted by a scheduled pg-boss job
- `ingestion_runs` rows are kept indefinitely (they're small — one row per run)
- Before deletion, a daily summary is upserted into a `pipeline_log_summaries` table
  (total calls, error rate, avg duration per loader per day) — keeps the history
  queryable without the row volume

---

# 7. What Does NOT Go in Logs

- API keys or secrets (never — URLs are sanitised before logging)
- Raw API response bodies (too large — store only the transformed row, not the source JSON)
- PII (no user data flows through the pipeline loaders)
