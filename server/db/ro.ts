/**
 * Read-only Postgres pool for the admin dashboard.
 * ---------------------------------------------------------------------------
 * Separate from `server/db/index.ts` (the read-WRITE app/loader pool). The
 * admin router imports ONLY this handle so a code bug can never write: the
 * underlying `tfa_ro` role is GRANTed SELECT only (see create_ro_role.sql),
 * and a write attempt is rejected by the database itself.
 *
 * Connection URL resolution:
 *   - Prefer DATABASE_URL_RO (points at the tfa_ro role).
 *   - In dev, if it is unset, fall back to DATABASE_URL with a loud warning so
 *     the dashboard still works locally before tfa_ro has been created.
 *
 * We never throw at import time: in production the admin API is 404'd anyway
 * (see server.ts), and throwing here would break the whole server boot just
 * because an unused RO URL is absent.
 */
import 'dotenv/config';
import postgres from 'postgres';

/** Hard per-connection query budget. Bounds slow scans, deep OFFSET, big counts. */
export const STMT_TIMEOUT_MS = 5000;

// Resolve the connection URL. DATABASE_URL_RO is authoritative; DATABASE_URL is
// the dev-only fallback (read-write — fine for SELECTs, just not true RO).
const roUrl = process.env.DATABASE_URL_RO;
const fallback = process.env.DATABASE_URL;
const url = roUrl ?? fallback ?? '';

if (!roUrl && fallback) {
  console.warn(
    '[admin] DATABASE_URL_RO unset — falling back to DATABASE_URL (read-write). ' +
    'Create the tfa_ro role (server/db/create_ro_role.sql) and set DATABASE_URL_RO ' +
    'for true read-only access.',
  );
}

/**
 * The ONLY DB handle admin.ts imports. Persistent module-level pool (reused
 * across requests, no per-request reconnect). `statement_timeout` is set on the
 * connection so any runaway query aborts with Postgres code 57014 instead of
 * hanging — the admin error mapper turns that into a clear "query timed out".
 *
 * No drizzle: the admin router issues raw catalog / data queries only.
 */
export const roSql = postgres(url, {
  max: 5,
  // postgres-js forwards `connection` keys as GUC session parameters. Its types
  // only declare numeric GUCs, but statement_timeout accepts the ms value; cast
  // through `any` so the parameter is set without loosening the call site.
  connection: { statement_timeout: STMT_TIMEOUT_MS } as any,
  onnotice: () => {}, // silence NOTICE chatter (e.g. role/grant notices)
});
