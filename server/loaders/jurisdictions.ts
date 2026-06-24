/**
 * Loader 0 — Jurisdictions (world-scope dimension table)
 * Populates: jurisdictions (all WTO reporting economies)
 * Source: WTO Timeseries API — /reporters endpoint
 * Run: npm run db:load:jurisdictions
 *
 * WHY THIS LOADER EXISTS (ADR-022 world-scope pivot):
 *   hs_mfn_duties.reporter_code and hs_preferential_rates.reporter_code are
 *   foreign keys to jurisdictions.code. To load tariffs for all ~164 WTO members
 *   we must FIRST populate jurisdictions with every member — otherwise the FK
 *   rejects the tariff insert. This loader is the unblocker for the world-scope
 *   tariff loads; it must run before db:load:mfn / db:load:pref.
 *
 * WHAT IT DOES:
 *   - GET /reporters → ~288 rows {code (ISO-numeric), iso3A (alpha-3), name, …}
 *   - Keeps only real countries: entries with iso3A != null. Aggregates such as
 *     "World", "Africa", "ACP" and blocs return iso3A=null and are skipped here —
 *     our blocs (EU, GCC) and the WORLD sentinel are curated by db:seed and left
 *     untouched.
 *   - Maps iso3A (alpha-3) → ISO alpha-2 for the canonical `code`, so the new
 *     rows match the existing curated rows (US, GB, AU, AE, IN). Any iso3A that
 *     has no alpha-2 equivalent is LOGGED, never silently dropped.
 *   - apiCodes.wto = the WTO numeric reporter code — this is exactly what the
 *     tariff loaders join on (jurisdictions.api_codes['wto']).
 *
 * NON-DESTRUCTIVE upsert: on a code that already exists (the 8 curated rows) we
 * ONLY merge apiCodes so a WTO code is filled in — we never overwrite a curated
 * name, appliesVat flag, kind, or an existing comtrade code.
 */
import 'dotenv/config';
import { db, sql as pgSql } from '../db/index';
import { jurisdictions, sources, ingestionRuns } from '../db/schema';
import { createLogger } from './_lib/logger';
import { eq, sql } from 'drizzle-orm';
import { createRequire } from 'node:module';

// i18n-iso-countries ships CommonJS but its .d.ts declares ES named exports —
// that mismatch breaks `import { alpha3ToAlpha2 }` at runtime in this ESM project.
// createRequire loads the real module.exports object reliably.
const require = createRequire(import.meta.url);
const isoCountries = require('i18n-iso-countries') as {
  alpha3ToAlpha2(alpha3: string): string | undefined;
};

const LOADER_NAME = 'jurisdictions';
const REPORTERS_URL = 'https://api.wto.org/timeseries/v1/reporters?lang=1';

/**
 * WTO uses a few legacy / non-standard alpha-3 codes that the ISO library does
 * not recognise, yet they are CURRENT trading economies we must not drop:
 *   CHT → TW  Chinese Taipei (Taiwan) — WTO member; ISO standard alpha-3 is TWN
 *   ROM → RO  Romania — WTO still uses the legacy ROM; ISO standard is ROU
 *   XKX → XK  Kosovo — user-assigned code (Kosovo has no official ISO numeric)
 * Everything else that fails to map (USSR, Yugoslavia, Belgium-Luxembourg, …) is
 * defunct or a bloc whose members are listed separately — correctly skipped.
 */
const WTO_ALPHA3_OVERRIDES: Record<string, string> = {
  CHT: 'TW',
  ROM: 'RO',
  XKX: 'XK',
};

const logger = createLogger(LOADER_NAME);

/** Shape of one row from WTO /reporters. */
interface WtoReporter {
  code: string;          // ISO-3166 numeric, zero-padded e.g. "840", "036"
  iso3A: string | null;  // ISO alpha-3 e.g. "USA"; null for aggregates/regions
  name: string;
  displayOrder: number;
}

async function run(): Promise<void> {
  logger.info('Starting jurisdictions loader (WTO /reporters → world-scope dimension)', {
    phase: 'init',
  });

  // ── Open an ingestion run for observability ──────────────────────────────
  // Reporters come from the same WTO API as MFN duties, so we attach the run to
  // the WTO duty_mfn source row (jurisdictions is a dimension, not its own layer).
  const [source] = await db.select().from(sources)
    .where(eq(sources.layer, 'duty_mfn')).limit(1);
  if (!source) {
    throw new Error('WTO duty_mfn source row not found — run db:seed first');
  }
  const [run] = await db.insert(ingestionRuns).values({
    sourceId: source.id, status: 'running',
  }).returning();
  const ingestionRunId = run.id;

  try {
    // ── Fetch all WTO reporting economies ──────────────────────────────────
    const started = Date.now();
    const res = await fetch(REPORTERS_URL, {
      headers: {
        'Ocp-Apim-Subscription-Key': process.env.WTO_API_KEY ?? '',
        'Accept': 'application/json',
      },
    });
    if (!res.ok) {
      throw new Error(`WTO /reporters returned HTTP ${res.status}`);
    }
    const reporters = (await res.json()) as WtoReporter[];

    logger.info(`Fetched ${reporters.length} WTO reporters`, {
      ingestionRunId, phase: 'fetch', apiName: 'wto', apiUrl: REPORTERS_URL,
      httpStatus: res.status, durationMs: Date.now() - started,
      meta: { total: reporters.length },
    });

    // ── Transform: countries only, alpha-3 → alpha-2 ───────────────────────
    let skippedAggregate = 0;
    const unmapped: string[] = [];
    const byCode = new Map<string, {
      code: string; kind: 'country'; name: string;
      isoNumeric: string; apiCodes: Record<string, string>;
    }>();

    for (const r of reporters) {
      if (!r.iso3A) { skippedAggregate++; continue; }          // aggregate/region, not a country
      const alpha2 = WTO_ALPHA3_OVERRIDES[r.iso3A] ?? isoCountries.alpha3ToAlpha2(r.iso3A);
      if (!alpha2) { unmapped.push(`${r.code}/${r.iso3A}/${r.name}`); continue; }

      // Last writer wins if two reporters collapse to the same alpha-2 (rare).
      byCode.set(alpha2, {
        code: alpha2,
        kind: 'country',
        name: r.name.slice(0, 128),
        isoNumeric: r.code,
        apiCodes: { wto: r.code },
      });
    }
    const values = Array.from(byCode.values());

    // ── Upsert — merge apiCodes only on conflict (preserve curated rows) ────
    await db.insert(jurisdictions).values(values).onConflictDoUpdate({
      target: jurisdictions.code,
      // existing || excluded : keep curated keys (e.g. comtrade), add/refresh wto.
      set: { apiCodes: sql`${jurisdictions.apiCodes} || excluded.api_codes` },
    });

    if (unmapped.length) {
      logger.warn(`No ISO alpha-2 for ${unmapped.length} reporters (skipped): ${unmapped.join('; ')}`, {
        ingestionRunId, phase: 'transform', errorCode: 'no_alpha2',
        meta: { unmapped },
      });
    }

    const total = await db.$count(jurisdictions);
    await db.update(ingestionRuns)
      .set({ status: 'succeeded', finishedAt: new Date(), rowsUpserted: values.length })
      .where(eq(ingestionRuns.id, ingestionRunId));

    logger.info(
      `Jurisdictions loaded: ${values.length} countries upserted, ` +
      `${skippedAggregate} aggregates skipped, ${unmapped.length} unmapped. ` +
      `jurisdictions table now has ${total} rows.`,
      {
        ingestionRunId, phase: 'done', tableAffected: 'jurisdictions',
        rowsAffected: values.length,
        meta: { upserted: values.length, skippedAggregate, unmapped: unmapped.length, totalRows: total },
      },
    );
  } catch (err) {
    const errorDetail = err instanceof Error ? err.message : String(err);
    logger.error('Jurisdictions loader failed', {
      ingestionRunId, phase: 'error', errorCode: 'loader_failed', errorDetail,
    });
    await db.update(ingestionRuns)
      .set({ status: 'failed', finishedAt: new Date(), error: errorDetail })
      .where(eq(ingestionRuns.id, ingestionRunId));
    throw err;
  } finally {
    await pgSql.end();
  }
}

run().catch((err) => {
  console.error('[jurisdictions] Fatal error:', err);
  process.exit(1);
});
