/**
 * Admin data dashboard API (read-only, introspection-driven).
 * ------------------------------------------------------------
 * The database catalog is the single source of truth: this router NEVER hardcodes
 * a table or column list. New tables/columns appear automatically because every
 * response is built from information_schema / pg_catalog at request time.
 *
 * SECURITY (defense in depth):
 *  - Mounted only when NODE_ENV !== 'production' AND a valid x-admin-token header
 *    is present — the gate lives in server.ts (`adminGate`), not here. This router
 *    assumes it is already gated.
 *  - Every identifier (table/column) is validated against the LIVE catalog before
 *    use. The allowlist is the real injection defense; `ident()` quoting is only a
 *    second layer. An unknown table → 404, an unknown column → ignored/400.
 *  - Every user VALUE is bound as a `$n` parameter via `sql.unsafe(q, params)` —
 *    never string-concatenated. `' OR '1'='1` becomes a literal → 0 rows.
 *  - Deny-listed tables (policy.ts) are hidden everywhere; masked columns never
 *    leave the server with real values.
 *  - All DB access goes through the read-only `tfa_ro` pool (roSql) — a write
 *    attempt is rejected by the DB role even on a code bug.
 * PERFORMANCE: SELECT-only, paginated (≤200 rows), fast reltuples estimates,
 * statement_timeout on the RO connection, and /schema in ≤2 round-trips.
 */
import { Router } from 'express';
import { roSql as sql } from '../db/ro';
import { isTableDenied, isColumnMasked, maskedColumnsFor } from './policy';

export const adminRouter = Router();

/* ── operator grammar (the public filter contract) ───────────────────────── */
export const OPS = new Set([
  'eq', 'neq', 'contains', 'gt', 'gte', 'lt', 'lte',
  'in', 'between', 'is_null', 'not_null', 'is_true', 'is_false',
]);
const CMP: Record<string, string> = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };

/** Postgres data_type strings we treat as numeric for cast/validation. */
const NUMERIC_TYPES = new Set([
  'smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision',
]);
/** Postgres data_type strings we treat as date/time for cast/validation. */
const TEMPORAL_TYPES = new Set([
  'timestamp with time zone', 'timestamp without time zone', 'date',
]);

/** Operators that ARE allowed to be a comparison/range (need value validation). */
const VALUE_CMP_OPS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between']);

/* ── catalog helpers ─────────────────────────────────────────────────────── */

/** All base tables in the public schema, with deny-listed tables removed. */
async function listTables(): Promise<string[]> {
  const rows = await sql<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name`;
  return rows.map((r) => r.table_name).filter((t) => !isTableDenied(t));
}

/** Column name → data_type map for one table (the per-request allowlist + cast info). */
async function listColumnTypes(table: string): Promise<Map<string, string>> {
  const rows = await sql<{ column_name: string; data_type: string }[]>`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}`;
  return new Map(rows.map((r) => [r.column_name, r.data_type]));
}

/** Quote an identifier that has already been validated against the catalog. */
const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

/* ── error mapping ───────────────────────────────────────────────────────── */

type MappedError = { status: number; body: { error: string; code?: string } };

/**
 * Map a thrown DB/runtime error to an HTTP status + message. Pure + exported so
 * QA can assert mappings without a live DB.
 *  - 57014  statement_timeout  → 503 "query timed out"
 *  - 22P02  invalid_text_representation (bad cast that slipped past validation),
 *    22007/22008 datetime errors → 400
 *  - connection / auth failures (ECONNREFUSED, 28P01, 3D000, 28000, 08*) → 500
 *    with a hint pointing at create_ro_role.sql.
 *  - anything else → 500.
 */
export function mapDbError(err: unknown): MappedError {
  const e = err as { code?: string; message?: string };
  const code = e?.code;
  const msg = e?.message ?? String(err);

  if (code === '57014') {
    return { status: 503, body: { error: 'query timed out (statement_timeout exceeded)', code } };
  }
  if (code === '22P02' || code === '22007' || code === '22008') {
    return { status: 400, body: { error: `invalid filter value: ${msg}`, code } };
  }
  // Role / connection problems → point the operator at the RO-role setup.
  const connCodes = new Set(['28P01', '3D000', '28000', '08000', '08006', '08001', '08003', '08004', '08P01']);
  const looksLikeConn =
    (code && (connCodes.has(code) || code.startsWith('08'))) ||
    /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|role .* does not exist|password authentication/i.test(msg);
  if (looksLikeConn) {
    return {
      status: 500,
      body: {
        error:
          'database connection/auth failed. Ensure the tfa_ro role exists and ' +
          'DATABASE_URL_RO is correct — see server/db/create_ro_role.sql.',
        code,
      },
    };
  }
  return { status: 500, body: { error: msg, code } };
}

/** Send a mapped error response. */
function sendError(res: import('express').Response, err: unknown) {
  const { status, body } = mapDbError(err);
  res.status(status).json(body);
}

/* ── pure, testable request-shaping helpers (no DB) ──────────────────────── */

export type Filter = { column?: unknown; op?: unknown; value?: unknown; value2?: unknown };

/** Result of building a single filter's SQL fragment. */
export type BuiltWhere = { sql: string; params: unknown[] };

export type PaginationInput = { page?: unknown; pageSize?: unknown; dir?: unknown };
export type Pagination = { page: number; pageSize: number; offset: number; dir: 'ASC' | 'DESC' };

/**
 * Clamp pagination + direction. Pure + exported for unit tests.
 *  - page  → integer ≥ 1 (non-numeric / ≤0 → 1)
 *  - pageSize → clamped to [1, 200] (non-numeric → 50, the default)
 *  - dir   → 'DESC' only when explicitly 'desc' (case-insensitive), else 'ASC'
 */
export function clampPagination(input: PaginationInput): Pagination {
  const pageRaw = Number(input.page);
  const page = Number.isFinite(pageRaw) ? Math.max(Math.floor(pageRaw), 1) : 1;

  const sizeRaw = Number(input.pageSize);
  const pageSize = Number.isFinite(sizeRaw)
    ? Math.min(Math.max(Math.floor(sizeRaw), 1), 200)
    : 50;

  const dir = String(input.dir ?? '').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  return { page, pageSize, offset: (page - 1) * pageSize, dir };
}

/**
 * Validate a single scalar filter value against a column's data_type. Pure +
 * exported. Returns the value to bind (possibly unchanged) or `false` if it is
 * not castable — the caller should respond 400. For non-numeric/non-temporal
 * types any value is accepted as-is.
 */
export function validateFilterValue(
  dataType: string,
  value: unknown,
): { ok: true; value: unknown } | { ok: false } {
  if (NUMERIC_TYPES.has(dataType)) {
    const n = Number(value);
    return Number.isFinite(n) && value !== '' && value !== null
      ? { ok: true, value }
      : { ok: false };
  }
  if (TEMPORAL_TYPES.has(dataType)) {
    return value != null && value !== '' && !Number.isNaN(Date.parse(String(value)))
      ? { ok: true, value }
      : { ok: false };
  }
  return { ok: true, value };
}

/** The SQL `::cast` suffix to apply for a column type ('' = no cast needed). */
function castSuffix(dataType: string): string {
  if (NUMERIC_TYPES.has(dataType)) return '::numeric';
  if (TEMPORAL_TYPES.has(dataType)) return '::timestamptz';
  return '';
}

/**
 * Build the WHERE clause + bound params for a list of filters. Pure + exported
 * so vitest can assert on the generated SQL string and params with NO database.
 *
 * @param filters   parsed filter array (may be garbage — each element is validated)
 * @param colTypes  allowlist: column name → data_type. Columns absent here (or
 *                  masked, since callers strip those first) are ignored entirely.
 * @returns { sql, params } where `sql` is the full clause incl. leading "WHERE"
 *          (or '' if no valid conditions) and `params` are the positional binds.
 *          Numeric/temporal comparison values that fail validation cause the
 *          whole build to throw a `BadFilterValueError` (→ 400 at the handler).
 */
export class BadFilterValueError extends Error {
  constructor(public column: string, public op: string) {
    super(`uncastable value for ${op} on ${column}`);
    this.name = 'BadFilterValueError';
  }
}

export function buildWhere(
  filters: Filter[],
  colTypes: Map<string, string>,
): BuiltWhere {
  const conds: string[] = [];
  const params: unknown[] = [];

  for (const f of filters) {
    if (!f || typeof f.column !== 'string' || typeof f.op !== 'string') continue;
    const dataType = colTypes.get(f.column);
    if (dataType === undefined) continue;          // not allowlisted (unknown or masked)
    if (!OPS.has(f.op)) continue;                  // op not in the grammar

    const col = ident(f.column);
    const op = f.op;

    // No-value boolean / null ops.
    if (op === 'is_null') { conds.push(`${col} IS NULL`); continue; }
    if (op === 'not_null') { conds.push(`${col} IS NOT NULL`); continue; }
    if (op === 'is_true') { conds.push(`${col} IS TRUE`); continue; }
    if (op === 'is_false') { conds.push(`${col} IS FALSE`); continue; }

    // Substring match — always on ::text so it works on any column type.
    if (op === 'contains') {
      params.push(`%${String(f.value ?? '')}%`);
      conds.push(`${col}::text ILIKE $${params.length}`);
      continue;
    }

    // IN — skip empty (no `IN ()`), cap to 1000 values, validate each scalar.
    if (op === 'in') {
      if (!Array.isArray(f.value) || f.value.length === 0) continue;
      const capped = f.value.slice(0, 1000);
      const cast = castSuffix(dataType);
      const ph: string[] = [];
      for (const v of capped) {
        const valid = validateFilterValue(dataType, v);
        if (!valid.ok) throw new BadFilterValueError(f.column, op);
        params.push(valid.value);
        ph.push(`$${params.length}${cast}`);
      }
      if (ph.length) conds.push(`${col}${cast} IN (${ph.join(',')})`);
      continue;
    }

    // BETWEEN — needs both bounds; missing 2nd bound → skip the filter entirely.
    if (op === 'between') {
      if (f.value === undefined || f.value === null || f.value2 === undefined || f.value2 === null) {
        continue;
      }
      const a = validateFilterValue(dataType, f.value);
      const b = validateFilterValue(dataType, f.value2);
      if (!a.ok || !b.ok) throw new BadFilterValueError(f.column, op);
      const cast = castSuffix(dataType);
      params.push(a.value); const ai = params.length;
      params.push(b.value); const bi = params.length;
      conds.push(`${col}${cast} BETWEEN $${ai}${cast} AND $${bi}${cast}`);
      continue;
    }

    // Scalar comparisons (eq/neq/gt/gte/lt/lte) — validate + cast.
    if (CMP[op]) {
      const valid = validateFilterValue(dataType, f.value);
      if (!valid.ok) throw new BadFilterValueError(f.column, op);
      const cast = castSuffix(dataType);
      params.push(valid.value);
      conds.push(`${col}${cast} ${CMP[op]} $${params.length}${cast}`);
      continue;
    }
  }

  return {
    sql: conds.length ? `WHERE ${conds.join(' AND ')}` : '',
    params,
  };
}

/* ── GET /tables — table list + fast row estimates ───────────────────────── */
adminRouter.get('/tables', async (_req, res) => {
  try {
    const tables = await sql<{ table_name: string; column_count: number }[]>`
      SELECT t.table_name,
             (SELECT count(*)::int FROM information_schema.columns c
              WHERE c.table_schema = 'public' AND c.table_name = t.table_name) AS column_count
      FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_name`;

    // reltuples is a fast estimate (no full scan); GREATEST(.,0) maps the -1
    // that Postgres returns for never-analyzed tables to 0.
    const est = await sql<{ relname: string; n: number }[]>`
      SELECT relname, GREATEST(reltuples, 0)::bigint AS n
      FROM pg_class
      WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace`;
    const estMap = new Map(est.map((e) => [e.relname, Number(e.n)]));

    // Deny-listed tables are filtered out so they are invisible to the UI.
    res.json(
      tables
        .filter((t) => !isTableDenied(t.table_name))
        .map((t) => ({
          tableName: t.table_name,
          columnCount: t.column_count,
          rowEstimate: estMap.get(t.table_name) ?? 0,
        })),
    );
  } catch (err) {
    sendError(res, err);
  }
});

/* ── GET /tables/:table/schema — column metadata (drives UI + filters) ─────
 * ROUND-TRIP BUDGET: ≤2.
 *   (1) ONE CTE query returns columns + PK flags + FK targets in a single pass.
 *       The BASE-TABLE existence check is folded into this query's EXISTS, so
 *       unknown tables / views come back as 0 rows (→ 404) without a separate
 *       catalog round-trip.
 *   (2) ONE batched enum query fetches all labels for every USER-DEFINED column
 *       via `WHERE typname = ANY(...)` — this kills the old per-column N+1.
 * No enum columns → query (2) is skipped → 1 round-trip. */
adminRouter.get('/tables/:table/schema', async (req, res) => {
  try {
    const { table } = req.params;
    // Denied tables 404 immediately (in-memory, no query). Unknown tables and
    // views are rejected after the CTE below returns 0 rows — same 404, and it
    // keeps this endpoint at ≤2 round-trips.
    if (isTableDenied(table)) {
      return res.status(404).json({ error: `unknown table: ${table}` });
    }

    // (1) columns + PK + FK in ONE round-trip via a CTE that LEFT JOINs the
    // primary-key and foreign-key column sets onto information_schema.columns.
    const cols = await sql<{
      column_name: string;
      data_type: string;
      udt_name: string;
      is_nullable: string;
      column_default: string | null;
      ordinal_position: number;
      is_pk: boolean;
      fk_table: string | null;
      fk_column: string | null;
    }[]>`
      WITH pk AS (
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        WHERE tc.table_schema = 'public' AND tc.table_name = ${table}
          AND tc.constraint_type = 'PRIMARY KEY'
      ),
      fk AS (
        SELECT kcu.column_name,
               ccu.table_name  AS fk_table,
               ccu.column_name AS fk_column
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        WHERE tc.table_schema = 'public' AND tc.table_name = ${table}
          AND tc.constraint_type = 'FOREIGN KEY'
      )
      SELECT c.column_name, c.data_type, c.udt_name, c.is_nullable,
             c.column_default, c.ordinal_position,
             (pk.column_name IS NOT NULL)      AS is_pk,
             fk.fk_table, fk.fk_column
      FROM information_schema.columns c
      LEFT JOIN pk ON pk.column_name = c.column_name
      LEFT JOIN fk ON fk.column_name = c.column_name
      WHERE c.table_schema = 'public' AND c.table_name = ${table}
        AND EXISTS (
          SELECT 1 FROM information_schema.tables it
          WHERE it.table_schema = 'public' AND it.table_name = ${table}
            AND it.table_type = 'BASE TABLE'
        )
      ORDER BY c.ordinal_position`;

    // Unknown table or a view (not a BASE TABLE) → the EXISTS guard returns 0
    // rows; same 404 as a denied/missing table, resolved without an extra query.
    if (cols.length === 0) {
      return res.status(404).json({ error: `unknown table: ${table}` });
    }

    // (2) ONE batched enum query for ALL USER-DEFINED columns (no N+1).
    const udtNames = [...new Set(
      cols.filter((c) => c.data_type === 'USER-DEFINED').map((c) => c.udt_name),
    )];
    const enumByType = new Map<string, string[]>();
    if (udtNames.length) {
      const labels = await sql<{ typname: string; enumlabel: string }[]>`
        SELECT t.typname, e.enumlabel
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = ANY(${udtNames})
        ORDER BY e.enumsortorder`;
      for (const l of labels) {
        const arr = enumByType.get(l.typname) ?? [];
        arr.push(l.enumlabel);
        enumByType.set(l.typname, arr);
      }
    }

    res.json({
      table,
      columns: cols.map((c) => ({
        name: c.column_name,
        dataType: c.data_type,
        udtName: c.udt_name,
        isNullable: c.is_nullable === 'YES',
        columnDefault: c.column_default,
        isPk: c.is_pk,
        isFk: c.fk_table !== null,
        fkTable: c.fk_table,
        fkColumn: c.fk_column,
        enumValues: c.data_type === 'USER-DEFINED' ? (enumByType.get(c.udt_name) ?? null) : null,
        masked: isColumnMasked(table, c.column_name),
        ordinal: c.ordinal_position,
      })),
    });
  } catch (err) {
    sendError(res, err);
  }
});

/* ── GET /tables/:table/distinct?column= — values for dropdown filters ────── */
adminRouter.get('/tables/:table/distinct', async (req, res) => {
  try {
    const { table } = req.params;
    const column = String(req.query.column ?? '');
    const limit = Math.min(Number(req.query.limit) || 100, 500);

    if (isTableDenied(table) || !(await listTables()).includes(table)) {
      return res.status(404).json({ error: `unknown table: ${table}` });
    }
    const colTypes = await listColumnTypes(table);
    // Masked columns are treated as not-allowlisted → 400 (never expose values).
    if (!colTypes.has(column) || isColumnMasked(table, column)) {
      return res.status(400).json({ error: `unknown column: ${column}` });
    }

    const q = `SELECT DISTINCT ${ident(column)} AS v FROM ${ident(table)}
               WHERE ${ident(column)} IS NOT NULL ORDER BY 1 LIMIT $1`;
    const rows = await sql.unsafe(q, [limit + 1]);
    const values = rows.map((r: any) => r.v);
    res.json({ values: values.slice(0, limit), truncated: values.length > limit });
  } catch (err) {
    sendError(res, err);
  }
});

/* ── GET /tables/:table/rows — paginated, filtered, sorted data ───────────── */
adminRouter.get('/tables/:table/rows', async (req, res) => {
  try {
    const { table } = req.params;
    if (isTableDenied(table) || !(await listTables()).includes(table)) {
      return res.status(404).json({ error: `unknown table: ${table}` });
    }

    // Allowlist = real columns MINUS masked ones (masked can't filter/sort/return).
    const allColTypes = await listColumnTypes(table);
    const masked = maskedColumnsFor(table);
    const colTypes = new Map<string, string>();
    for (const [name, type] of allColTypes) {
      if (!masked.has(name)) colTypes.set(name, type);
    }

    const { page, pageSize, offset, dir } = clampPagination({
      page: req.query.page, pageSize: req.query.pageSize, dir: req.query.dir,
    });

    // Filters arrive as a JSON array: [{ column, op, value, value2 }].
    // Malformed JSON → ignored (treated as no filters), not a 500.
    let filters: Filter[] = [];
    if (req.query.filters) {
      try {
        const parsed = JSON.parse(String(req.query.filters));
        if (Array.isArray(parsed)) filters = parsed;
      } catch { filters = []; }
    }

    // buildWhere validates + casts numeric/temporal values; an uncastable value
    // throws BadFilterValueError → mapped to 400 below.
    let where: BuiltWhere;
    try {
      where = buildWhere(filters, colTypes);
    } catch (e) {
      if (e instanceof BadFilterValueError) {
        return res.status(400).json({ error: e.message });
      }
      throw e;
    }

    // Sort — validated against the (non-masked) allowlist; invalid → no ORDER BY.
    const sortReq = String(req.query.sort ?? '');
    const orderBy = colTypes.has(sortReq) ? `ORDER BY ${ident(sortReq)} ${dir}` : '';

    const tbl = ident(table);
    const params = where.params;
    const dataQ =
      `SELECT * FROM ${tbl} ${where.sql} ${orderBy} ` +
      `LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    // `params` is unknown[] (kept that way so buildWhere is DB-agnostic + unit
    // testable); cast to any[] only at the sql.unsafe boundary.
    const rows = await sql.unsafe(dataQ, [...params, pageSize, offset] as any[]) as Record<string, unknown>[];

    const countQ = `SELECT count(*)::int AS n FROM ${tbl} ${where.sql}`;
    const [{ n: total }] = await sql.unsafe(countQ, [...params] as any[]) as any;

    // Null out masked column values before they leave the server.
    if (masked.size) {
      for (const row of rows) {
        for (const m of masked) {
          if (m in row) row[m] = null;
        }
      }
    }

    res.json({ rows, total, page, pageSize });
  } catch (err) {
    sendError(res, err);
  }
});
