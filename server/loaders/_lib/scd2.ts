/**
 * SCD Type-2 upsert helper (ADR-023) — shared by every fact loader.
 *
 * WHY: trade data must be append-on-change, never overwrite. The product's value
 * is being able to answer "this tariff went 5% → 7% in March". A blind upsert
 * destroys that. A blind append bloats the table with identical re-fetches. This
 * helper does the middle path: a NEW version row is written ONLY when a value
 * actually changed; an unchanged re-fetch just bumps last_verified_at.
 *
 * Each fact table carries: version, valid_from, valid_to, is_current, row_hash,
 * last_verified_at, plus a partial unique index that guarantees exactly one
 * is_current row per natural key. This helper is the only writer that maintains
 * those invariants.
 *
 * Three outcomes per call:
 *   inserted  — first time we've seen this natural key (version 1)
 *   verified  — value identical to the current row; just refresh freshness stamps
 *   versioned — value changed: close the old row (valid_to, is_current=false) and
 *               insert a new row (version+1, is_current=true) inside one txn
 */
import { createHash } from 'node:crypto';
import { and, eq, SQL } from 'drizzle-orm';
import { db } from '../../db/index';

export type Scd2Result = 'inserted' | 'verified' | 'versioned';

/**
 * Stable hash of the changing value fields. Keys are sorted so column order can
 * never change the hash; null/undefined normalise to '' so a missing measure and
 * an explicit null compare equal (they mean the same thing here).
 */
export function hashValues(values: Record<string, unknown>): string {
  const canon = Object.keys(values)
    .sort()
    .map((k) => `${k}=${values[k] ?? ''}`)
    .join('|');
  return createHash('sha256').update(canon).digest('hex');
}

export interface Scd2Params {
  /** A fact table with the SCD-2 columns (hsMfnDuties, hsPreferentialRates, …). */
  table: any;
  /** WHERE condition identifying the natural key (caller builds it with eq()/and()). */
  naturalKey: SQL;
  /** Changing measures — these are hashed and drive versioning. */
  valueFields: Record<string, unknown>;
  /** Immutable context written on insert: the natural-key columns + source_id, etc. */
  staticFields: Record<string, unknown>;
  fetchedAt: Date;
  staleAt: Date;
  expiresAt: Date;
  ingestionRunId: string;
}

export async function scd2Upsert(p: Scd2Params): Promise<Scd2Result> {
  const t = p.table;
  const rowHash = hashValues(p.valueFields);

  // Find the current version of this natural key, if any.
  const [current] = await db
    .select()
    .from(t)
    .where(and(p.naturalKey, eq(t.isCurrent, true)))
    .limit(1);

  // ── First sighting → version 1 ──────────────────────────────────────────
  if (!current) {
    await db.insert(t).values({
      ...p.staticFields,
      ...p.valueFields,
      version: 1,
      isCurrent: true,
      validFrom: p.fetchedAt,
      validTo: null,
      rowHash,
      lastVerifiedAt: p.fetchedAt,
      fetchedAt: p.fetchedAt,
      staleAt: p.staleAt,
      expiresAt: p.expiresAt,
      ingestionRunId: p.ingestionRunId,
    });
    return 'inserted';
  }

  // ── Unchanged → just confirm it's still current ─────────────────────────
  if (current.rowHash === rowHash) {
    await db
      .update(t)
      .set({ lastVerifiedAt: p.fetchedAt, staleAt: p.staleAt, expiresAt: p.expiresAt })
      .where(eq(t.id, current.id));
    return 'verified';
  }

  // ── Changed → close the old row, open a new version (atomic) ─────────────
  await db.transaction(async (tx) => {
    await tx
      .update(t)
      .set({ isCurrent: false, validTo: p.fetchedAt })
      .where(eq(t.id, current.id));
    await tx.insert(t).values({
      ...p.staticFields,
      ...p.valueFields,
      version: (current.version as number) + 1,
      isCurrent: true,
      validFrom: p.fetchedAt,
      validTo: null,
      rowHash,
      lastVerifiedAt: p.fetchedAt,
      fetchedAt: p.fetchedAt,
      staleAt: p.staleAt,
      expiresAt: p.expiresAt,
      ingestionRunId: p.ingestionRunId,
    });
  });
  return 'versioned';
}
