/**
 * Admin dashboard — the auto-discovery "brain".
 * ------------------------------------------------------------------
 * Maps a column's catalog metadata (`ColumnMeta`) to the right filter control
 * and the operators that control may emit. This is purely data-driven: it reads
 * ONLY `ColumnMeta` (dataType / enumValues / isNullable / masked). That is why a
 * brand-new table+migration gets correct filters with zero UI code change —
 * nothing here references a specific table or column name.
 *
 * Mapping:
 *   enum (enumValues != null | USER-DEFINED) → multiselect   → in
 *   text / varchar / character varying / etc → text          → contains (+ eq)
 *   numeric (int/bigint/numeric/double/…)    → range         → between / gte / lte (+ eq/neq)
 *   boolean                                  → tri-state      → is_true / is_false / (any = none)
 *   timestamp / date                         → date-range     → between (ISO) (+ gte / lte)
 *   uuid                                     → exact text     → eq (+ neq)
 *   (anything else)                          → text fallback  → contains
 * is_null / not_null are appended for any nullable column.
 * Masked columns get NO control (skipped) — they cannot be filtered.
 */
import type { ColumnMeta, FilterOp } from './types';

export type ControlKind =
  | 'multiselect'
  | 'text'
  | 'range'
  | 'tristate'
  | 'daterange'
  | 'exact';

export interface ColumnControl {
  kind: ControlKind;
  /** Ops this control can produce, in display order. */
  ops: FilterOp[];
}

/* ── Postgres data_type classification (information_schema.data_type) ─────── */

const NUMERIC_TYPES = new Set([
  'smallint',
  'integer',
  'bigint',
  'numeric',
  'decimal',
  'real',
  'double precision',
]);

const TEXT_TYPES = new Set([
  'text',
  'character varying',
  'varchar',
  'character',
  'char',
  'name',
  'citext',
]);

const TIMESTAMP_TYPES = new Set([
  'timestamp with time zone',
  'timestamp without time zone',
  'timestamp',
  'date',
  'time with time zone',
  'time without time zone',
  'time',
]);

function isEnum(col: ColumnMeta): boolean {
  // pg enums surface as data_type 'USER-DEFINED'; the server also resolves the
  // labels into enumValues. Either signal is sufficient.
  return (col.enumValues != null && col.enumValues.length > 0) || col.dataType === 'USER-DEFINED';
}

function isUuid(col: ColumnMeta): boolean {
  return col.dataType === 'uuid';
}

function isBoolean(col: ColumnMeta): boolean {
  return col.dataType === 'boolean';
}

function isNumeric(col: ColumnMeta): boolean {
  return NUMERIC_TYPES.has(col.dataType);
}

function isText(col: ColumnMeta): boolean {
  return TEXT_TYPES.has(col.dataType);
}

function isTimestamp(col: ColumnMeta): boolean {
  return TIMESTAMP_TYPES.has(col.dataType);
}

/**
 * The base control for a column, before nullability ops are appended.
 * Order matters: enum is checked first (an enum-backed column may also be a
 * text-ish udt), then uuid/boolean/numeric/timestamp, then text, then a safe
 * text fallback for anything unrecognised (e.g. jsonb, arrays, inet).
 */
function baseControl(col: ColumnMeta): ColumnControl {
  if (isEnum(col)) return { kind: 'multiselect', ops: ['in'] };
  if (isUuid(col)) return { kind: 'exact', ops: ['eq', 'neq'] };
  if (isBoolean(col)) return { kind: 'tristate', ops: ['is_true', 'is_false'] };
  if (isNumeric(col)) return { kind: 'range', ops: ['between', 'gte', 'lte', 'eq', 'neq'] };
  if (isTimestamp(col)) return { kind: 'daterange', ops: ['between', 'gte', 'lte'] };
  if (isText(col)) return { kind: 'text', ops: ['contains', 'eq'] };
  // Fallback for jsonb / arrays / inet / unknown: contains runs over ::text on
  // the server, which is the safest universal filter.
  return { kind: 'text', ops: ['contains'] };
}

/**
 * The control + allowed ops for a column. Returns `null` for masked columns
 * (no control at all). `is_null`/`not_null` are added for nullable columns so
 * the UI can offer them on any control.
 */
export function controlForColumn(col: ColumnMeta): ColumnControl | null {
  if (col.masked) return null;

  const control = baseControl(col);
  if (col.isNullable) {
    return { kind: control.kind, ops: [...control.ops, 'is_null', 'not_null'] };
  }
  return control;
}

/** Whether a column should render a filter control at all. */
export function isFilterable(col: ColumnMeta): boolean {
  return !col.masked;
}

/** Ops that carry no value (rendered without an input). */
export const VALUELESS_OPS: ReadonlySet<FilterOp> = new Set<FilterOp>([
  'is_null',
  'not_null',
  'is_true',
  'is_false',
]);

/** Human labels for ops, for the op selector. */
export const OP_LABELS: Record<FilterOp, string> = {
  eq: '=',
  neq: '≠',
  contains: 'contains',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  in: 'is any of',
  between: 'between',
  is_null: 'is null',
  not_null: 'is not null',
  is_true: 'is true',
  is_false: 'is false',
};
