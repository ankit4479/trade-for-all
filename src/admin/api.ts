/**
 * Admin dashboard — typed fetch client + token storage.
 * ------------------------------------------------------------------
 * Talks to the gated `/api/admin/*` router. The admin token is a shared secret
 * kept in localStorage and sent as the `x-admin-token` header on every call.
 *
 * The server is the security boundary; this module just carries the token and
 * surfaces a 401 as a typed error so the UI can re-prompt + clear the token.
 *
 * Every request takes an AbortSignal so callers can cancel in-flight fetches
 * (rapid table switches) and never let a stale response overwrite fresh state.
 */
import type {
  TableSummary,
  TableSchema,
  DistinctResponse,
  RowsResponse,
  Filter,
} from './types';

const BASE = '/api/admin';
const TOKEN_KEY = 'admin_token';

/* ── token storage ───────────────────────────────────────────────────────── */

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* localStorage unavailable (private mode) — token just won't persist. */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/* ── errors ──────────────────────────────────────────────────────────────── */

/** Thrown on a 401 so the UI can show the token prompt and clear the token. */
export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/** Thrown on any non-OK, non-401 response, carrying the HTTP status. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/* ── core fetch ──────────────────────────────────────────────────────────── */

interface FetchOpts {
  /** Query params; arrays/objects are JSON-stringified (used for `filters`). */
  params?: Record<string, unknown>;
  signal?: AbortSignal;
}

async function adminFetch<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const token = getToken();
  const url = new URL(BASE + path, window.location.origin);
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
  }

  const res = await fetch(url.toString(), {
    headers: token ? { 'x-admin-token': token } : {},
    signal: opts.signal,
  });

  if (res.status === 401) {
    throw new UnauthorizedError(await safeError(res, 'Unauthorized'));
  }
  if (!res.ok) {
    throw new ApiError(res.status, await safeError(res, `Request failed (${res.status})`));
  }
  return res.json() as Promise<T>;
}

/** Pull an `{ error }` message out of a failed response, falling back safely. */
async function safeError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body.error === 'string') return body.error;
  } catch {
    /* non-JSON body */
  }
  return fallback;
}

/* ── typed endpoints ─────────────────────────────────────────────────────── */

export function listTables(signal?: AbortSignal): Promise<TableSummary[]> {
  return adminFetch<TableSummary[]>('/tables', { signal });
}

export function getSchema(table: string, signal?: AbortSignal): Promise<TableSchema> {
  return adminFetch<TableSchema>(`/tables/${encodeURIComponent(table)}/schema`, { signal });
}

export function getDistinct(
  table: string,
  column: string,
  limit = 200,
  signal?: AbortSignal,
): Promise<DistinctResponse> {
  return adminFetch<DistinctResponse>(`/tables/${encodeURIComponent(table)}/distinct`, {
    params: { column, limit },
    signal,
  });
}

export interface RowsQuery {
  page: number;
  pageSize: number;
  sort?: string;
  dir?: 'asc' | 'desc';
  filters?: Filter[];
}

export function getRows(
  table: string,
  q: RowsQuery,
  signal?: AbortSignal,
): Promise<RowsResponse> {
  return adminFetch<RowsResponse>(`/tables/${encodeURIComponent(table)}/rows`, {
    params: {
      page: q.page,
      pageSize: q.pageSize,
      sort: q.sort,
      dir: q.dir,
      // Serialized as a JSON query param; omitted when empty so the server's
      // try/catch never even sees it.
      filters: q.filters && q.filters.length ? q.filters : undefined,
    },
    signal,
  });
}
