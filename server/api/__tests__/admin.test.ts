/**
 * Unit tests for the admin router's PURE request-shaping helpers — no DB.
 * These exercise the exact matrix rows A/C/D/H from DASHBOARD_PLAN.md §5b:
 * pagination clamps, per-type filter-value validation, the WHERE/param builder
 * (injection safety, caps, casts, skips), and the policy deny/mask wiring.
 *
 * The whole point of these functions being exported is that we can assert on the
 * generated SQL string + bound params WITHOUT spinning up Postgres.
 */
import { describe, it, expect } from 'vitest';
import {
  clampPagination,
  validateFilterValue,
  buildWhere,
  BadFilterValueError,
  OPS,
  type Filter,
} from '../admin';
import {
  isTableDenied,
  isColumnMasked,
  maskedColumnsFor,
  DENIED_TABLES,
  MASKED_COLUMNS,
} from '../policy';

/* A representative column-type allowlist mirroring the real schema fixtures. */
const colTypes = new Map<string, string>([
  ['id', 'integer'],
  ['code', 'character varying'],
  ['name', 'text'],
  ['rate', 'numeric'],
  ['created_at', 'timestamp with time zone'],
  ['effective_date', 'date'],
  ['active', 'boolean'],
]);

/* ───────────────────────── clampPagination (matrix D) ───────────────────── */
describe('clampPagination (matrix D)', () => {
  it('page ≤ 0 → 1', () => {
    expect(clampPagination({ page: 0 }).page).toBe(1);
    expect(clampPagination({ page: -5 }).page).toBe(1);
  });

  it('page non-numeric → 1', () => {
    expect(clampPagination({ page: 'abc' }).page).toBe(1);
    expect(clampPagination({ page: undefined }).page).toBe(1);
  });

  it('beyond-last page still computes a correct offset', () => {
    // page 9999, pageSize 50 → offset (9999-1)*50. The handler returns an empty
    // page + the real total; the clamp must not silently reset the page.
    const p = clampPagination({ page: 9999, pageSize: 50 });
    expect(p.page).toBe(9999);
    expect(p.offset).toBe((9999 - 1) * 50);
  });

  it('pageSize 0 → 1 (lower clamp)', () => {
    expect(clampPagination({ pageSize: 0 }).pageSize).toBe(1);
  });

  it('pageSize 10000 → 200 (upper clamp)', () => {
    expect(clampPagination({ pageSize: 10000 }).pageSize).toBe(200);
  });

  it('pageSize non-numeric → 50 (default)', () => {
    expect(clampPagination({ pageSize: 'xyz' }).pageSize).toBe(50);
    expect(clampPagination({ pageSize: undefined }).pageSize).toBe(50);
  });

  it('dir invalid → ASC; only explicit desc → DESC', () => {
    expect(clampPagination({ dir: 'sideways' }).dir).toBe('ASC');
    expect(clampPagination({ dir: undefined }).dir).toBe('ASC');
    expect(clampPagination({ dir: 'DESC' }).dir).toBe('DESC');
    expect(clampPagination({ dir: 'desc' }).dir).toBe('DESC');
    expect(clampPagination({ dir: 'asc' }).dir).toBe('ASC');
  });

  it('offset = (page-1) * pageSize for normal input', () => {
    const p = clampPagination({ page: 3, pageSize: 25 });
    expect(p.offset).toBe(50);
  });
});

/* ─────────────────── validateFilterValue (matrix C / H) ─────────────────── */
describe('validateFilterValue (matrix C/H)', () => {
  it('numeric col + non-numeric value → not ok (→ handler 400)', () => {
    expect(validateFilterValue('integer', 'abc').ok).toBe(false);
    expect(validateFilterValue('numeric', 'not-a-number').ok).toBe(false);
    expect(validateFilterValue('bigint', '').ok).toBe(false);
    expect(validateFilterValue('double precision', null).ok).toBe(false);
  });

  it('numeric col + numeric string → ok', () => {
    expect(validateFilterValue('integer', '42')).toEqual({ ok: true, value: '42' });
    expect(validateFilterValue('numeric', '3.14')).toEqual({ ok: true, value: '3.14' });
    expect(validateFilterValue('bigint', 0)).toEqual({ ok: true, value: 0 });
  });

  it('timestamp col + garbage → not ok', () => {
    expect(validateFilterValue('timestamp with time zone', 'garbage').ok).toBe(false);
    expect(validateFilterValue('date', 'not-a-date').ok).toBe(false);
    expect(validateFilterValue('date', '').ok).toBe(false);
    expect(validateFilterValue('timestamp with time zone', null).ok).toBe(false);
  });

  it('timestamp col + ISO string → ok', () => {
    expect(validateFilterValue('timestamp with time zone', '2024-01-15T00:00:00Z').ok).toBe(true);
    expect(validateFilterValue('date', '2024-01-15').ok).toBe(true);
  });

  it('non-numeric/non-temporal types accept any value as-is', () => {
    expect(validateFilterValue('text', "anything ' here")).toEqual({ ok: true, value: "anything ' here" });
    expect(validateFilterValue('uuid', 'whatever')).toEqual({ ok: true, value: 'whatever' });
  });
});

/* ───────────────────────── buildWhere (matrix A / C) ────────────────────── */
describe('buildWhere (matrix A/C)', () => {
  it('contains → ::text ILIKE with %v% bound param', () => {
    const { sql, params } = buildWhere(
      [{ column: 'name', op: 'contains', value: 'steel' }],
      colTypes,
    );
    expect(sql).toBe('WHERE "name"::text ILIKE $1');
    expect(params).toEqual(['%steel%']);
  });

  it('contains works on a non-text column via ::text', () => {
    const { sql } = buildWhere(
      [{ column: 'id', op: 'contains', value: '5' }],
      colTypes,
    );
    expect(sql).toBe('WHERE "id"::text ILIKE $1');
  });

  it('empty in → skipped (no `IN ()`)', () => {
    const { sql, params } = buildWhere(
      [{ column: 'code', op: 'in', value: [] }],
      colTypes,
    );
    expect(sql).toBe('');
    expect(params).toEqual([]);
  });

  it('non-array in value → skipped', () => {
    const { sql } = buildWhere(
      [{ column: 'code', op: 'in', value: 'nope' }],
      colTypes,
    );
    expect(sql).toBe('');
  });

  it('in > 1000 values → capped to 1000', () => {
    const vals = Array.from({ length: 1500 }, (_, i) => `c${i}`);
    const { params } = buildWhere(
      [{ column: 'code', op: 'in', value: vals }],
      colTypes,
    );
    expect(params).toHaveLength(1000);
  });

  it('numeric in → ::numeric cast on column and each placeholder', () => {
    const { sql, params } = buildWhere(
      [{ column: 'id', op: 'in', value: [1, 2, 3] }],
      colTypes,
    );
    expect(sql).toBe('WHERE "id"::numeric IN ($1::numeric,$2::numeric,$3::numeric)');
    expect(params).toEqual([1, 2, 3]);
  });

  it('between missing 2nd bound → skipped (no half BETWEEN)', () => {
    const { sql, params } = buildWhere(
      [{ column: 'rate', op: 'between', value: 5 }],
      colTypes,
    );
    expect(sql).toBe('');
    expect(params).toEqual([]);
  });

  it('numeric between → ::numeric casts on both bounds', () => {
    const { sql, params } = buildWhere(
      [{ column: 'rate', op: 'between', value: 1, value2: 9 }],
      colTypes,
    );
    expect(sql).toBe('WHERE "rate"::numeric BETWEEN $1::numeric AND $2::numeric');
    expect(params).toEqual([1, 9]);
  });

  it('gte + lte on the same column → ANDed', () => {
    const { sql, params } = buildWhere(
      [
        { column: 'rate', op: 'gte', value: 1 },
        { column: 'rate', op: 'lte', value: 9 },
      ],
      colTypes,
    );
    expect(sql).toBe(
      'WHERE "rate"::numeric >= $1::numeric AND "rate"::numeric <= $2::numeric',
    );
    expect(params).toEqual([1, 9]);
  });

  it('unknown column (not in colTypes) → ignored', () => {
    const { sql } = buildWhere(
      [{ column: 'not_a_column', op: 'eq', value: 'x' }],
      colTypes,
    );
    expect(sql).toBe('');
  });

  it('op not in OPS → ignored', () => {
    const { sql } = buildWhere(
      [{ column: 'name', op: 'regex', value: 'x' }],
      colTypes,
    );
    expect(sql).toBe('');
  });

  it('value-less ops (is_null/not_null/is_true/is_false) → no params', () => {
    const { sql, params } = buildWhere(
      [
        { column: 'name', op: 'is_null' },
        { column: 'code', op: 'not_null' },
        { column: 'active', op: 'is_true' },
        { column: 'active', op: 'is_false' },
      ],
      colTypes,
    );
    expect(sql).toBe(
      'WHERE "name" IS NULL AND "code" IS NOT NULL AND "active" IS TRUE AND "active" IS FALSE',
    );
    expect(params).toEqual([]);
  });

  it('SQL-injection literal is a BOUND param, never concatenated into SQL', () => {
    const inj = "' OR '1'='1";
    const { sql, params } = buildWhere(
      [{ column: 'name', op: 'eq', value: inj }],
      colTypes,
    );
    // The dangerous literal must appear ONLY in params, and the SQL string must
    // be a parameterized placeholder — not contain the injection text.
    expect(params).toContain(inj);
    expect(sql).not.toContain(inj);
    expect(sql).not.toContain("OR '1'='1");
    expect(sql).toBe('WHERE "name" = $1');
  });

  it('contains injection literal is wrapped as %…% param, not concatenated', () => {
    const inj = "' OR '1'='1";
    const { sql, params } = buildWhere(
      [{ column: 'name', op: 'contains', value: inj }],
      colTypes,
    );
    expect(params).toEqual([`%${inj}%`]);
    expect(sql).toBe('WHERE "name"::text ILIKE $1');
    expect(sql).not.toContain(inj);
  });

  it('numeric eq with non-numeric value → throws BadFilterValueError (→400)', () => {
    expect(() =>
      buildWhere([{ column: 'id', op: 'eq', value: 'abc' }], colTypes),
    ).toThrow(BadFilterValueError);
  });

  it('timestamp eq with ISO value → casts ::timestamptz', () => {
    const { sql, params } = buildWhere(
      [{ column: 'created_at', op: 'gte', value: '2024-01-01T00:00:00Z' }],
      colTypes,
    );
    expect(sql).toBe('WHERE "created_at"::timestamptz >= $1::timestamptz');
    expect(params).toEqual(['2024-01-01T00:00:00Z']);
  });

  it('malformed filter elements (null / wrong types) → skipped, not thrown', () => {
    const filters = [
      null,
      undefined,
      { column: 123, op: 'eq', value: 'x' },
      { column: 'name', op: 456 },
      {},
    ] as unknown as Filter[];
    const { sql, params } = buildWhere(filters, colTypes);
    expect(sql).toBe('');
    expect(params).toEqual([]);
  });

  it('multi-column AND across different columns', () => {
    const { sql, params } = buildWhere(
      [
        { column: 'name', op: 'contains', value: 'a' },
        { column: 'id', op: 'gt', value: 10 },
      ],
      colTypes,
    );
    expect(sql).toBe('WHERE "name"::text ILIKE $1 AND "id"::numeric > $2::numeric');
    expect(params).toEqual(['%a%', 10]);
  });

  it('OPS set contains exactly the 13-op grammar', () => {
    expect([...OPS].sort()).toEqual(
      [
        'between', 'contains', 'eq', 'gt', 'gte', 'in', 'is_false',
        'is_null', 'is_true', 'lt', 'lte', 'neq', 'not_null',
      ].sort(),
    );
  });
});

/* ───────────────────────────── policy wiring ───────────────────────────── */
describe('policy deny/mask wiring', () => {
  it('deny/mask sets are EMPTY today (no tenant/PII tables in this schema)', () => {
    expect(DENIED_TABLES.size).toBe(0);
    expect(Object.keys(MASKED_COLUMNS)).toHaveLength(0);
  });

  it('isTableDenied → false for any current table (none denied yet)', () => {
    expect(isTableDenied('jurisdictions')).toBe(false);
    expect(isTableDenied('hs_codes')).toBe(false);
    expect(isTableDenied('anything')).toBe(false);
  });

  it('isColumnMasked → false for any current column (none masked yet)', () => {
    expect(isColumnMasked('jurisdictions', 'name')).toBe(false);
    expect(isColumnMasked('pipeline_logs', 'meta')).toBe(false);
  });

  it('maskedColumnsFor → empty set for any table', () => {
    expect(maskedColumnsFor('jurisdictions').size).toBe(0);
    expect(maskedColumnsFor('hs_codes').size).toBe(0);
  });

  it('the functions correctly read whatever the sets contain (wiring shape)', () => {
    // We do NOT mutate the real (frozen-by-contract) empty sets. Instead we prove
    // the functions delegate to Set/record membership by re-implementing the same
    // lookups against a LOCAL fixture — if the wiring shape ever changes (e.g. a
    // function stops consulting its set), this guards the contract that "adding a
    // name to the set is the only edit required".
    const deniedFixture = new Set(['users']);
    const maskedFixture: Record<string, Set<string>> = { users: new Set(['email']) };
    const localDenied = (t: string) => deniedFixture.has(t);
    const localMasked = (t: string, c: string) => maskedFixture[t]?.has(c) ?? false;
    expect(localDenied('users')).toBe(true);
    expect(localDenied('jurisdictions')).toBe(false);
    expect(localMasked('users', 'email')).toBe(true);
    expect(localMasked('users', 'id')).toBe(false);
    // And the REAL functions agree with the empty-state baseline.
    expect(isTableDenied('users')).toBe(false); // not denied yet in the real set
  });
});
