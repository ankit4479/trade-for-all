/**
 * Sensitive-data policy — the single, authoritative source of truth for what the
 * admin dashboard is allowed to expose.
 * ---------------------------------------------------------------------------
 * The SERVER is the security boundary. `src/admin/policy.ts` is a cosmetic
 * client copy that only renders `•••`; it can never be trusted. Every check
 * here is also enforced server-side in `server/api/admin.ts`:
 *
 *   - DENIED tables:  absent from GET /tables; 404 on /schema, /distinct, /rows
 *                     (indistinguishable from "table does not exist").
 *   - MASKED columns: flagged `masked:true` in /schema; excluded from the
 *                     filter / sort / distinct allowlist; their VALUES are
 *                     replaced with null in /rows before the response leaves
 *                     the server. Real masked data never reaches the client.
 *
 * Both collections are intentionally EMPTY today — this repo's schema holds only
 * shared trade-reference data (no tenant_id, no PII). The module exists so that
 * the day a `users` / `tenant_*` table or a secret column lands, the only edit
 * required is adding a name here; the enforcement is already wired everywhere.
 */

/** Tables that must be completely hidden from the dashboard. */
export const DENIED_TABLES: ReadonlySet<string> = new Set<string>([
  // e.g. 'users', 'api_keys', 'tenant_secrets'
]);

/**
 * Columns whose values must never be returned. Shape: { table: Set<column> }.
 * A masked column is still listed in /schema (with `masked:true`) so the UI can
 * render a `•••` placeholder, but it cannot be filtered, sorted, or read.
 */
export const MASKED_COLUMNS: Record<string, ReadonlySet<string>> = {
  // e.g. users: new Set(['password_hash', 'email']),
};

/** True if `table` is on the deny-list and must be hidden entirely. */
export function isTableDenied(table: string): boolean {
  return DENIED_TABLES.has(table);
}

/** True if `column` on `table` is masked (value must not be returned). */
export function isColumnMasked(table: string, column: string): boolean {
  return MASKED_COLUMNS[table]?.has(column) ?? false;
}

/** The set of masked columns for `table` (empty set if none). */
export function maskedColumnsFor(table: string): ReadonlySet<string> {
  return MASKED_COLUMNS[table] ?? EMPTY_SET;
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>();
