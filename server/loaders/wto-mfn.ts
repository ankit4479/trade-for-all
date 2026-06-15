/**
 * Loader 3 — WTO MFN Duties + Preferential Rates
 * Populates: hs_mfn_duties, hs_preferential_rates
 * Source: WTO Timeseries API — HS_A_* and HS_P_* indicators
 * Run: npm run db:load:mfn
 *
 * Phase A (default): fetches HS-2 chapter codes (96 codes × 5 countries × 6 indicators = 2,880 calls)
 * Phase B (--level=4): fetches HS-4 heading codes (1,229 codes × 5 countries × 6 indicators)
 *
 * Rate: 1.5s/call. Phase A ≈ 72 minutes. Run overnight.
 * Set HS_CHAPTER env var to load a single chapter: HS_CHAPTER=09 npm run db:load:mfn
 */
import 'dotenv/config';
import { db, sql as pgSql } from '../db/index';
import {
  hsMfnDuties, hsPreferentialRates, hsCodes,
  ingestionRuns, jurisdictions, sources,
} from '../db/schema';
import { createLogger } from './_lib/logger';
import { wtoFetch } from './_lib/wto-client';
import { computeFreshness } from './_lib/freshness';
import { eq, and, sql, gt } from 'drizzle-orm';

const LOADER_NAME  = 'wto-mfn';
const YEAR         = 2023;
const PARTNER_CODE = 'IN';  // origin country for preferential rate lookups

const logger = createLogger(LOADER_NAME);

// MFN indicators → hs_mfn_duties fields
const MFN_INDICATORS = [
  { code: 'HS_A_0010', field: 'simpleAvgPct'    as const },
  { code: 'HS_A_0020', field: 'maxRatePct'       as const },
  { code: 'HS_A_0030', field: 'dutyFreePct'      as const },
  { code: 'HS_A_0040', field: 'nbrTariffLines'   as const },
  { code: 'HS_A_0050', field: 'nbrNavLines'      as const },
];

interface MfnFields {
  simpleAvgPct:    number | null;
  maxRatePct:      number | null;
  dutyFreePct:     number | null;
  nbrTariffLines:  number | null;
  nbrNavLines:     number | null;
}

async function run(): Promise<void> {
  const singleChapter = process.env.HS_CHAPTER ?? null;
  const level         = process.argv.includes('--level=4') ? 4 : 2;

  logger.info('Starting WTO MFN loader', {
    phase: 'init',
    meta: { level, singleChapter, year: YEAR },
  });

  // Load HS codes for the target level
  const hsQuery = db.select({ code: hsCodes.code })
    .from(hsCodes)
    .where(
      singleChapter
        ? and(eq(hsCodes.level, level), eq(hsCodes.code, singleChapter))
        : eq(hsCodes.level, level),
    );

  const hsRows = await hsQuery;

  if (hsRows.length === 0) {
    throw new Error(`No HS codes found at level ${level}${singleChapter ? ` for chapter ${singleChapter}` : ''} — run db:load:hs first`);
  }

  logger.info(`Found ${hsRows.length} HS codes at level ${level}`, {
    phase: 'init', meta: { hsCodeCount: hsRows.length },
  });

  // Load destination jurisdictions (non-India countries + blocs with WTO codes)
  const allJurisdictions = await db.select().from(jurisdictions);
  const destinations = allJurisdictions.filter((j) => {
    const apiCodes = j.apiCodes as Record<string, string>;
    return j.code !== 'IN' && j.code !== 'WORLD' && apiCodes?.['wto'];
  });

  // Get India's WTO code for preferential rate lookups
  const india = allJurisdictions.find((j) => j.code === 'IN');
  const indiaWtoCode = india ? (india.apiCodes as Record<string, string>)['wto'] : '356';

  // Resolve source
  const [source] = await db.select().from(sources)
    .where(eq(sources.layer, 'duty_mfn')).limit(1);
  if (!source) throw new Error('Source row for duty_mfn not found — run db:seed first');

  const [run] = await db.insert(ingestionRuns).values({
    sourceId: source.id, status: 'running',
  }).returning();
  const ingestionRunId = run.id;

  const { staleAt, expiresAt } = computeFreshness('annual');
  const fetchedAt  = new Date();
  let totalUpserted = 0;
  let totalSkipped  = 0;
  const total = hsRows.length * destinations.length;
  let processed = 0;

  logger.info(`Processing ${total} (hs_code × country) combinations`, {
    ingestionRunId, phase: 'fetch',
    meta: { hsCodeCount: hsRows.length, countryCount: destinations.length },
  });

  try {
    for (const { code: hsCode } of hsRows) {
      for (const jurisdiction of destinations) {
        processed++;
        const apiCodes = jurisdiction.apiCodes as Record<string, string>;
        const wtoCode  = apiCodes['wto'];

        // ── Freshness check — skip if a non-expired row already exists ──
        const now = new Date();
        const [existing] = await db
          .select({ expiresAt: hsMfnDuties.expiresAt })
          .from(hsMfnDuties)
          .where(
            and(
              eq(hsMfnDuties.reporterCode, jurisdiction.code),
              eq(hsMfnDuties.hsCode, hsCode),
              eq(hsMfnDuties.year, YEAR),
              gt(hsMfnDuties.expiresAt, now),
            ),
          )
          .limit(1);

        if (existing) {
          logger.info(`[${processed}/${total}] SKIP (fresh until ${existing.expiresAt?.toISOString().split('T')[0]}) ${jurisdiction.code} / HS ${hsCode}`, {
            ingestionRunId, phase: 'skip',
            reporterCode: jurisdiction.code, hsCode,
            meta: { reason: 'fresh_in_db', expiresAt: existing.expiresAt },
          });
          totalSkipped++;
          continue;
        }

        logger.info(`[${processed}/${total}] FETCH ${jurisdiction.code} / HS ${hsCode}`, {
          ingestionRunId, phase: 'fetch',
          reporterCode: jurisdiction.code, hsCode,
        });

        // ── Fetch MFN indicators ──────────────────────────────────────
        const mfnFields: MfnFields = {
          simpleAvgPct:   null,
          maxRatePct:     null,
          dutyFreePct:    null,
          nbrTariffLines: null,
          nbrNavLines:    null,
        };
        let hasMfnData = false;

        for (const { code: indicator, field } of MFN_INDICATORS) {
          const res = await wtoFetch({
            indicator,
            reporter:      wtoCode,
            productCode:   hsCode,
            year:          YEAR,
            loaderName:    LOADER_NAME,
            ingestionRunId,
            reporterCode:  jurisdiction.code,
            hsCode,
          });

          if (res.status === 204 || res.dataset.length === 0) {
            logger.warn(`No MFN data: ${indicator} / ${jurisdiction.code} / HS ${hsCode}`, {
              ingestionRunId, indicator,
              reporterCode: jurisdiction.code, hsCode, year: YEAR,
              errorCode: 'no_coverage',
            });
            continue;
          }

          const value = res.dataset[0]?.Value ?? null;
          (mfnFields as Record<string, unknown>)[field] = value;
          hasMfnData = true;
        }

        if (hasMfnData) {
          await db.insert(hsMfnDuties).values({
            reporterCode:   jurisdiction.code,
            hsCode,
            hsEdition:      'HS2022',
            year:           YEAR,
            simpleAvgPct:   mfnFields.simpleAvgPct,
            maxRatePct:     mfnFields.maxRatePct,
            dutyFreePct:    mfnFields.dutyFreePct,
            nbrTariffLines: mfnFields.nbrTariffLines,
            nbrNavLines:    mfnFields.nbrNavLines,
            sourceId:       source.id,
            ingestionRunId,
            fetchedAt,
            staleAt,
            expiresAt,
          }).onConflictDoUpdate({
            target: [hsMfnDuties.reporterCode, hsMfnDuties.hsCode, hsMfnDuties.hsEdition, hsMfnDuties.year],
            set: {
              simpleAvgPct:   mfnFields.simpleAvgPct,
              maxRatePct:     mfnFields.maxRatePct,
              dutyFreePct:    mfnFields.dutyFreePct,
              nbrTariffLines: mfnFields.nbrTariffLines,
              nbrNavLines:    mfnFields.nbrNavLines,
              fetchedAt,
              staleAt,
              expiresAt,
            },
          });
          totalUpserted++;
          logger.info(`MFN upserted: ${jurisdiction.code} / HS ${hsCode} = ${mfnFields.simpleAvgPct}%`, {
            ingestionRunId, phase: 'upsert', tableAffected: 'hs_mfn_duties',
            reporterCode: jurisdiction.code, hsCode, year: YEAR, rowsAffected: 1,
          });
        } else {
          totalSkipped++;
        }

        // ── Fetch preferential rate (India → this country) ────────────
        const prefRes = await wtoFetch({
          indicator:    'HS_P_0070',
          reporter:     wtoCode,
          productCode:  hsCode,
          loaderName:   LOADER_NAME,
          ingestionRunId,
          reporterCode: jurisdiction.code,
          partnerCode:  PARTNER_CODE,
          hsCode,
        });

        const coverageStatus = prefRes.status === 204 || prefRes.dataset.length === 0
          ? 'no_fta'
          : 'available';

        const prefValue = coverageStatus === 'available'
          ? (prefRes.dataset[0]?.Value ?? null)
          : null;

        if (coverageStatus === 'no_fta') {
          logger.warn(`No FTA: IN → ${jurisdiction.code} / HS ${hsCode}`, {
            ingestionRunId, indicator: 'HS_P_0070',
            reporterCode: jurisdiction.code, partnerCode: PARTNER_CODE, hsCode,
            errorCode: 'no_coverage',
          });
        }

        await db.insert(hsPreferentialRates).values({
          reporterCode:   jurisdiction.code,
          partnerCode:    PARTNER_CODE,
          hsCode,
          hsEdition:      'HS2022',
          year:           YEAR,
          simpleAvgPct:   prefValue,
          coverageStatus,
          sourceId:       source.id,
          ingestionRunId,
          fetchedAt,
          staleAt,
          expiresAt,
        }).onConflictDoUpdate({
          target: [
            hsPreferentialRates.reporterCode,
            hsPreferentialRates.partnerCode,
            hsPreferentialRates.hsCode,
            hsPreferentialRates.hsEdition,
            hsPreferentialRates.year,
          ],
          set: {
            simpleAvgPct:   prefValue,
            coverageStatus,
            fetchedAt,
            staleAt,
            expiresAt,
          },
        });
      }
    }

    await db.update(ingestionRuns)
      .set({ status: 'succeeded', finishedAt: new Date(), rowsUpserted: totalUpserted })
      .where(eq(ingestionRuns.id, ingestionRunId));

    logger.info(`WTO MFN loader complete — ${totalUpserted} upserted, ${totalSkipped} skipped`, {
      ingestionRunId, phase: 'done',
      rowsAffected: totalUpserted,
      meta: { totalUpserted, totalSkipped },
    });

  } catch (err) {
    const errorDetail = err instanceof Error ? err.message : String(err);
    logger.error('WTO MFN loader failed', {
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
  console.error('[wto-mfn] Fatal error:', err);
  process.exit(1);
});
