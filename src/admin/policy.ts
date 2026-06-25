/**
 * Admin dashboard — client-side presentation policy (COSMETIC ONLY).
 * ------------------------------------------------------------------
 * The server is the security boundary: masked columns arrive from `/rows` with
 * their values already nulled, and the schema marks them `masked: true`. This
 * module only decides how to *render* that — never what to hide. Do not rely on
 * it for security.
 */
import type { ColumnMeta, TableSchema } from './types';

/** The placeholder shown in place of a masked value. */
export const MASKED_PLACEHOLDER = '•••'; // •••

/** The string to render for a masked cell. */
export function renderMaskedValue(): string {
  return MASKED_PLACEHOLDER;
}

/** Whether a column is masked, per the server-provided schema flag. */
export function isMaskedColumn(schema: TableSchema | null, column: string): boolean {
  if (!schema) return false;
  const col = schema.columns.find((c) => c.name === column);
  return col?.masked ?? false;
}

/** Convenience: is this specific ColumnMeta masked? */
export function isMasked(col: ColumnMeta): boolean {
  return col.masked;
}
