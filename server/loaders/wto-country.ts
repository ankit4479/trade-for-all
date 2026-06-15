/**
 * Loader 2 — WTO Country Tariff Profiles
 * Populates: country_tariff_profiles
 * Source: WTO Timeseries API — TP_A_* indicators (30 calls, ~45 seconds)
 * Run: npm run db:load:country
 *
 * Fetches country-level tariff context for all 5 destination jurisdictions.
 * Used to show "USA average MFN: 3.3%" alongside product-level rates.
 */
import 'dotenv/config';
import { db, sql as pgSql } from '../db/index';
import { countryTariffProfiles, ingestionRuns, jurisdictions, sources } from '../db/schema';
import { createLogger } from './_lib/logger';
import { wtoFetch } from './_lib/wto-client';
import { computeFreshness } from './_lib/freshness';
import { eq, and, gt } from 'drizzle-orm';

const LOADER_NAME = 'wto-country';
const YEAR        = 2023;

const logger = createLogger(LOADER_NAME);

// Indicators to fetch and which field they map to
const INDICATORS: Array<{ code: string; field: keyof ProfileFields }> = [
  { code: 'TP_A_0010', field: 'simpleAvgMfnAllPct' },
  { code: 'TP_A_0030', field: 'tradeWtdMfnAllPct' },
  { code: 'TP_A_0160', field: 'simpleAvgMfnAgrPct' },
  { code: 'TP_A_0170', field: 'tradeWtdMfnAgrPct' },
  { code: 'TP_A_0430', field: 'simpleAvgMfnNonAgrPct' },
  { code: 'TP_A_0440', field: 'tradeWtdMfnNonAgrPct' },
];

interface ProfileFields {
  simpleAvgMfnAllPct:    number | null;
  tradeWtdMfnAllPct:     number | null;
  simpleAvgMfnAgrPct:    number | null;
  tradeWtdMfnAgrPct:     number | null;
  simpleAvgMfnNonAgrPct: number | null;
  tradeWtdMfnNonAgrPct:  number | null;
}

async function run(): Promise<void> {
  logger.info('Starting WTO country profiles loader', { phase: 'init', tableAffected: 'country_tariff_profiles' });

  // Load destination jurisdictions (countries + blocs, not WORLD)
  const destinations = await db
    .select()
    .from(jurisdictions)
    .where(eq(jurisdictions.kind, 'country'));

  // Also include blocs (EU, GCC) which have WTO reporter codes
  const blocs = await db
    .select()
    .from(jurisdictions)
    .where(eq(jurisdictions.kind, 'bloc'));

  const targets = [...destinations, ...blocs].filter(
    (j) => j.code !== 'IN' && j.apiCodes && (j.apiCodes as Record<string,string>)['wto'],
  );

  logger.info(`Will fetch profiles for ${targets.length} jurisdictions`, {
    phase: 'init',
    meta: { jurisdictions: targets.map((j) => j.code) },
  });

  // Resolve source
  const [source] = await db
    .select()
    .from(sources)
    .where(eq(sources.layer, 'duty_mfn'))
    .limit(1);

  if (!source) throw new Error('Source row for duty_mfn not found — run db:seed first');

  const [run] = await db.insert(ingestionRuns).values({
    sourceId: source.id, status: 'running',
  }).returning();
  const ingestionRunId = run.id;

  const { staleAt, expiresAt } = computeFreshness('annual');
  const fetchedAt = new Date();
  let totalUpserted = 0;

  try {
    for (const jurisdiction of targets) {
      const apiCodes = jurisdiction.apiCodes as Record<string, string>;
      const wtoCode  = apiCodes['wto'];
      const fields: ProfileFields = {
        simpleAvgMfnAllPct:    null,
        tradeWtdMfnAllPct:     null,
        simpleAvgMfnAgrPct:    null,
        tradeWtdMfnAgrPct:     null,
        simpleAvgMfnNonAgrPct: null,
        tradeWtdMfnNonAgrPct:  null,
      };

      // ── Freshness check — skip if a non-expired profile already exists ──
      const now = new Date();
      const [existing] = await db
        .select({ expiresAt: countryTariffProfiles.expiresAt })
        .from(countryTariffProfiles)
        .where(
          and(
            eq(countryTariffProfiles.reporterCode, jurisdiction.code),
            eq(countryTariffProfiles.year, YEAR),
            gt(countryTariffProfiles.expiresAt, now),
          ),
        )
        .limit(1);

      if (existing) {
        logger.info(`SKIP ${jurisdiction.code} — profile fresh until ${existing.expiresAt?.toISOString().split('T')[0]}`, {
          ingestionRunId, phase: 'skip', reporterCode: jurisdiction.code,
          meta: { reason: 'fresh_in_db', expiresAt: existing.expiresAt },
        });
        totalUpserted++;
        continue;
      }

      logger.info(`Fetching profile for ${jurisdiction.code} (WTO code: ${wtoCode})`, {
        ingestionRunId, phase: 'fetch', reporterCode: jurisdiction.code,
      });

      for (const { code: indicator, field } of INDICATORS) {
        try {
          const res = await wtoFetch({
            indicator,
            reporter:       wtoCode,
            year:           YEAR,
            loaderName:     LOADER_NAME,
            ingestionRunId,
            reporterCode:   jurisdiction.code,
          });

          if (res.status === 204 || res.status === 400 || res.dataset.length === 0) {
            logger.warn(`No data for ${indicator} / ${jurisdiction.code} (status ${res.status})`, {
              ingestionRunId, indicator, reporterCode: jurisdiction.code,
              year: YEAR, errorCode: 'no_coverage',
            });
            continue;
          }

          // TP_A_* indicators return a single value (country-level, no product dimension)
          const value = res.dataset[0]?.Value ?? null;
          fields[field] = value;

          logger.info(`${indicator} = ${value}% for ${jurisdiction.code}`, {
            ingestionRunId, indicator, reporterCode: jurisdiction.code, year: YEAR,
          });
        } catch (err) {
          logger.warn(`Skipping ${indicator} / ${jurisdiction.code} — ${err instanceof Error ? err.message : err}`, {
            ingestionRunId, indicator, reporterCode: jurisdiction.code,
            errorCode: 'indicator_error',
          });
        }
      }

      await db
        .insert(countryTariffProfiles)
        .values({
          reporterCode:              jurisdiction.code,
          year:                      YEAR,
          simpleAvgMfnAllPct:        fields.simpleAvgMfnAllPct,
          tradeWtdMfnAllPct:         fields.tradeWtdMfnAllPct,
          simpleAvgMfnAgrPct:        fields.simpleAvgMfnAgrPct,
          tradeWtdMfnAgrPct:         fields.tradeWtdMfnAgrPct,
          simpleAvgMfnNonAgrPct:     fields.simpleAvgMfnNonAgrPct,
          tradeWtdMfnNonAgrPct:      fields.tradeWtdMfnNonAgrPct,
          sourceId:                  source.id,
          ingestionRunId,
          fetchedAt,
          staleAt,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: [countryTariffProfiles.reporterCode, countryTariffProfiles.year],
          set: {
            simpleAvgMfnAllPct:    fields.simpleAvgMfnAllPct,
            tradeWtdMfnAllPct:     fields.tradeWtdMfnAllPct,
            simpleAvgMfnAgrPct:    fields.simpleAvgMfnAgrPct,
            tradeWtdMfnAgrPct:     fields.tradeWtdMfnAgrPct,
            simpleAvgMfnNonAgrPct: fields.simpleAvgMfnNonAgrPct,
            tradeWtdMfnNonAgrPct:  fields.tradeWtdMfnNonAgrPct,
            fetchedAt,
            staleAt,
            expiresAt,
          },
        });

      totalUpserted++;
      logger.info(`Profile upserted for ${jurisdiction.code}`, {
        ingestionRunId, phase: 'upsert',
        tableAffected: 'country_tariff_profiles',
        reporterCode: jurisdiction.code,
        rowsAffected: 1,
      });
    }

    await db.update(ingestionRuns)
      .set({ status: 'succeeded', finishedAt: new Date(), rowsUpserted: totalUpserted })
      .where(eq(ingestionRuns.id, ingestionRunId));

    logger.info(`WTO country profiles complete — ${totalUpserted} profiles upserted`, {
      ingestionRunId, phase: 'done', rowsAffected: totalUpserted,
    });

  } catch (err) {
    const errorDetail = err instanceof Error ? err.message : String(err);
    logger.error('WTO country profiles loader failed', {
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
  console.error('[wto-country] Fatal error:', err);
  process.exit(1);
});
