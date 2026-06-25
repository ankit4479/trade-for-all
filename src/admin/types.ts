/**
 * Admin dashboard — API contract types.
 * ------------------------------------------------------------------
 * These mirror the server's `/api/admin/*` JSON responses EXACTLY (see
 * server/api/admin.ts). The server is introspection-driven: it builds every
 * response from the live Postgres catalog, so the UI never hardcodes a table
 * or column. Keep these shapes in lockstep with the backend contract.
 */

/** One row of the sidebar table list (`GET /tables`). */
export interface TableSummary {
  tableName: string;
  columnCount: number;
  rowEstimate: number;
}

/**
 * Metadata for a single column (`GET /tables/:table/schema` → columns[]).
 * Drives the schema panel, the auto-generated filter controls, and cell
 * rendering. `masked` is authoritative from the server: masked columns never
 * carry real values and cannot be filtered/sorted.
 */
export interface ColumnMeta {
  name: string;
  dataType: string;
  isNullable: boolean;
  columnDefault: string | null;
  isPk: boolean;
  isFk: boolean;
  fkTable: string | null;
  fkColumn: string | null;
  /** Enum labels for pg-enum columns, else null. */
  enumValues: string[] | null;
  /** Server flags sensitive columns; values arrive nulled, UI renders •••. */
  masked: boolean;
}

/** Full schema for one table (`GET /tables/:table/schema`). */
export interface TableSchema {
  table: string;
  columns: ColumnMeta[];
}

/**
 * The 13 server-supported filter operators. The op grammar is LOCKED — any op
 * outside this set is ignored by the server.
 */
export type FilterOp =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'between'
  | 'is_null'
  | 'not_null'
  | 'is_true'
  | 'is_false';

/**
 * A single filter clause sent to `/rows`. `value`/`value2` are optional:
 * value-less ops (is_null/not_null/is_true/is_false) omit both; `between` uses
 * both; `in` uses `value` as an array.
 */
export interface Filter {
  column: string;
  op: FilterOp;
  value?: unknown;
  value2?: unknown;
}

/** Paginated rows (`GET /tables/:table/rows`). */
export interface RowsResponse {
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
}

/** Distinct column values for dropdown filters (`GET /tables/:table/distinct`). */
export interface DistinctResponse {
  values: unknown[];
  truncated: boolean;
}
