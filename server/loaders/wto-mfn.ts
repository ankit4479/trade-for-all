/**
 * Loader 3 — WTO MFN Duties + Preferential Rates (chapter-batched)
 * Populates: hs_mfn_duties, hs_preferential_rates
 * Source: WTO Timeseries API — HS_A_* and HS_P_* indicators
 * Run: npm run db:load:mfn
 *
 * Batching strategy (confirmed via live API tests):
 *   - indicators (i=): NOT batchable — one call per indicator
 *   - reporters (r=): batchable — all countries in one call (3-digit zero-padded)
 *   - product codes (pc=): batchable — all HS-6 codes for a chapter in one call
 *
 * Per chapter (98 total):
 *   5 MFN indicator calls × 1 call (all HS-6 + all countries) = 5 calls
 *   1 preferential indicator call (all HS-6 + all countries, partner=India) = 1 call
 *   Total: 98 chapters × 6 calls = 588 calls at 1 req/s ≈ 10 minutes
 *   (vs old approach: 206,940 calls ≈ 57 hours)
 *
 * Resumability: skip entire chapter if all its HS-6 rows are fresh in DB.
 * Single chapter mode: HS_CHAPTER=09 npm run db:load:mfn
 */
import 'dotenv/config';
import { db, sql as pgSql } from '../db/index';
import {
  hsMfnDuties, hsPreferentialRates, hsCodes,
  ingestionRuns, jurisdictions, sources,
} from '../db/schema';
import { createLogger } from './_lib/logger';
import { wtoFetch } from './_lib/wto-client';
import { computeFreshness, isFresh } from './_lib/freshness';
import { scd2Upsert, Scd2Result } from './_lib/scd2';
import { eq, and, gt, count, sql } from 'drizzle-orm';

const LOADER_NAME  = 'wto-mfn';
const YEAR         = 2023;
const PARTNER_CODE = 'IN';

const logger = createLogger(LOADER_NAME);

const MFN_INDICATORS: Array<{ code: string; field: keyof MfnFields }> = [
  { code: 'HS_A_0010', field: 'simpleAvgPct'   },
  { code: 'HS_A_0020', field: 'maxRatePct'      },
  { code: 'HS_A_0030', field: 'dutyFreePct'     },
  { code: 'HS_A_0040', field: 'nbrTariffLines'  },
  { code: 'HS_A_0050', field: 'nbrNavLines'     },
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

  logger.info('Starting WTO MFN loader (chapter-batched)', {
    phase: 'init',
    meta: { singleChapter, year: YEAR, strategy: 'chapter_batch' },
  });

  // ── Load all destination jurisdictions ───────────────────────────────────
  const allJurisdictions = await db.select().from(jurisdictions);
  const destinations = allJurisdictions.filter((j) => {
    const apiCodes = j.apiCodes as Record<string, string>;
    return j.code !== 'IN' && j.code !== 'WORLD' && j.code !== 'GCC' && apiCodes?.['wto'];
  });

  const india = allJurisdictions.find((j) => j.code === 'IN');
  const indiaWtoCode = india ? (india.apiCodes as Record<string, string>)['wto'] : '356';

  // Build the reporter string for WTO (all countries in one param)
  // WTO requires exactly 3-digit zero-padded codes
  const reporterCodes = destinations.map((j) => {
    const wto = (j.apiCodes as Record<string, string>)['wto'];
    return wto.padStart(3, '0');
  });
  const reporterParam = reporterCodes.join(',');

  logger.info(`Destinations: ${destinations.map((j) => j.code).join(', ')}`, {
    phase: 'init',
    meta: { reporterParam },
  });

  // ── Load HS-6 codes grouped by chapter ───────────────────────────────────
  const allHs6 = await db
    .select({ code: hsCodes.code })
    .from(hsCodes)
    .where(eq(hsCodes.level, 6));

  // Group into chapters (first 2 digits)
  const byChapter = new Map<string, string[]>();
  for (const { code } of allHs6) {
    const chapter = code.slice(0, 2);
    if (singleChapter && chapter !== singleChapter) continue;
    const list = byChapter.get(chapter) ?? [];
    list.push(code);
    byChapter.set(chapter, list);
  }

  const chapters = [...byChapter.keys()].sort();
  if (chapters.length === 0) {
    throw new Error('No HS-6 codes found — run db:load:hs first');
  }

  logger.info(`Processing ${chapters.length} chapters, ${allHs6.length} HS-6 codes total`, {
    phase: 'init',
    meta: { chapterCount: chapters.length, hs6Count: allHs6.length },
  });

  // ── Resolve source + open ingestion run ──────────────────────────────────
  const [source] = await db.select().from(sources)
    .where(eq(sources.layer, 'duty_mfn')).limit(1);
  if (!source) throw new Error('Source row for duty_mfn not found — run db:seed first');

  const [run] = await db.insert(ingestionRuns).values({
    sourceId: source.id, status: 'running',
  }).returning();
  const ingestionRunId = run.id;

  const { staleAt, expiresAt } = computeFreshness('annual');
  const fetchedAt = new Date();
  let totalMfnUpserted   = 0;
  let totalPrefUpserted  = 0;
  let totalChaptersSkipped = 0;
  let chaptersDone = 0;
  // SCD-2 outcome tally — proves versioning is working at a glance.
  const tally: Record<Scd2Result, number> = { inserted: 0, verified: 0, versioned: 0 };

  try {
    for (const chapter of chapters) {
      chaptersDone++;
      const hs6Codes = byChapter.get(chapter)!;
      const pcParam  = hs6Codes.join(',');

      // ── Freshness check: skip entire chapter if all its HS-6 rows are fresh ──
      const now = new Date();
      const [freshCheck] = await db
        .select({ fresh: count() })
        .from(hsMfnDuties)
        .where(
          and(
            sql`LEFT(${hsMfnDuties.hsCode}, 2) = ${chapter}`,
            eq(hsMfnDuties.year, YEAR),
            gt(hsMfnDuties.expiresAt, now),
          ),
        );

      // A chapter is fully fresh if we have at least (hs6Codes.length) fresh rows
      // (one per HS-6 code — may be fewer countries but at least 1 reporter covered)
      if (freshCheck && freshCheck.fresh >= hs6Codes.length) {
        logger.info(`[${chaptersDone}/${chapters.length}] SKIP chapter ${chapter} — ${freshCheck.fresh} fresh rows in DB`, {
          ingestionRunId, phase: 'skip',
          meta: { chapter, freshRows: freshCheck.fresh, hs6Count: hs6Codes.length },
        });
        totalChaptersSkipped++;
        continue;
      }

      logger.info(`[${chaptersDone}/${chapters.length}] FETCH chapter ${chapter} (${hs6Codes.length} HS-6 codes × ${destinations.length} countries)`, {
        ingestionRunId, phase: 'fetch',
        meta: { chapter, hs6Count: hs6Codes.length, reporters: reporterParam },
      });

      // ── Accumulate MFN fields per (reporterCode × hsCode) ────────────────
      const mfnMap = new Map<string, MfnFields>();
      const keyOf  = (reporter: string, hsCode: string) => `${reporter}|${hsCode}`;

      for (const { code: indicator, field } of MFN_INDICATORS) {
        const res = await wtoFetch({
          indicator,
          reporter:      reporterParam,
          productCode:   pcParam,
          year:          YEAR,
          loaderName:    LOADER_NAME,
          ingestionRunId,
          logHsCode:     `ch${chapter}`,  // chapter-level label, not the full batch string
        });

        if (res.status === 204 || res.dataset.length === 0) {
          logger.warn(`No data: ${indicator} / chapter ${chapter}`, {
            ingestionRunId, indicator,
            meta: { chapter, errorCode: 'no_coverage' },
          });
          continue;
        }

        for (const row of res.dataset) {
          const k = keyOf(row.ReportingEconomyCode, row.ProductOrSectorCode);
          const existing = mfnMap.get(k) ?? {
            simpleAvgPct: null, maxRatePct: null,
            dutyFreePct: null, nbrTariffLines: null, nbrNavLines: null,
          };
          (existing as unknown as Record<string, unknown>)[field] = row.Value;
          mfnMap.set(k, existing);
        }
      }

      // ── Upsert MFN rows ───────────────────────────────────────────────────
      // Map WTO reporter codes back to our jurisdiction codes
      const wtoToCode = new Map(
        destinations.map((j) => [
          (j.apiCodes as Record<string, string>)['wto'].padStart(3, '0'),
          j.code,
        ]),
      );

      for (const [key, fields] of mfnMap) {
        const [wtoReporter, hsCode] = key.split('|');
        const reporterCode = wtoToCode.get(wtoReporter);
        if (!reporterCode) continue;

        const result = await scd2Upsert({
          table:      hsMfnDuties,
          naturalKey: and(
            eq(hsMfnDuties.reporterCode, reporterCode),
            eq(hsMfnDuties.hsCode, hsCode),
            eq(hsMfnDuties.hsEdition, 'HS2022'),
            eq(hsMfnDuties.year, YEAR),
          )!,
          valueFields: {
            simpleAvgPct:   fields.simpleAvgPct,
            maxRatePct:     fields.maxRatePct,
            dutyFreePct:    fields.dutyFreePct,
            nbrTariffLines: fields.nbrTariffLines,
            nbrNavLines:    fields.nbrNavLines,
          },
          staticFields: {
            reporterCode, hsCode, hsEdition: 'HS2022', year: YEAR, sourceId: source.id,
          },
          fetchedAt, staleAt, expiresAt, ingestionRunId,
        });
        tally[result]++;
        totalMfnUpserted++;
      }

      logger.info(`Chapter ${chapter} MFN: ${mfnMap.size} rows upserted`, {
        ingestionRunId, phase: 'upsert', tableAffected: 'hs_mfn_duties',
        meta: { chapter, rows: mfnMap.size },
      });

      // ── Fetch preferential rates (India → each destination, all HS-6) ─────
      const prefRes = await wtoFetch({
        indicator:    'HS_P_0070',
        reporter:     reporterParam,
        productCode:  pcParam,
        year:         YEAR,
        loaderName:   LOADER_NAME,
        ingestionRunId,
        partnerCode:  PARTNER_CODE,
        logHsCode:    `ch${chapter}`,
      });

      // Build a set of (wtoReporter|hsCode) that returned data
      const prefData = new Map<string, number | null>();
      for (const row of prefRes.dataset) {
        prefData.set(keyOf(row.ReportingEconomyCode, row.ProductOrSectorCode), row.Value);
      }

      // Write a row for every (destination × HS-6) combination
      for (const destination of destinations) {
        const wtoCode = (destination.apiCodes as Record<string, string>)['wto'].padStart(3, '0');
        for (const hsCode of hs6Codes) {
          const prefKey       = keyOf(wtoCode, hsCode);
          const hasData       = prefData.has(prefKey);
          const coverageStatus = hasData ? 'available' : 'no_fta';
          const prefValue     = hasData ? prefData.get(prefKey) ?? null : null;

          const result = await scd2Upsert({
            table:      hsPreferentialRates,
            naturalKey: and(
              eq(hsPreferentialRates.reporterCode, destination.code),
              eq(hsPreferentialRates.partnerCode, PARTNER_CODE),
              eq(hsPreferentialRates.hsCode, hsCode),
              eq(hsPreferentialRates.hsEdition, 'HS2022'),
              eq(hsPreferentialRates.year, YEAR),
            )!,
            valueFields: { simpleAvgPct: prefValue, coverageStatus },
            staticFields: {
              reporterCode: destination.code, partnerCode: PARTNER_CODE,
              hsCode, hsEdition: 'HS2022', year: YEAR, sourceId: source.id,
            },
            fetchedAt, staleAt, expiresAt, ingestionRunId,
          });
          tally[result]++;
          totalPrefUpserted++;
        }
      }

      logger.info(`Chapter ${chapter} pref: ${prefData.size} FTA rows, ${hs6Codes.length * destinations.length - prefData.size} no_fta`, {
        ingestionRunId, phase: 'upsert', tableAffected: 'hs_preferential_rates',
        meta: { chapter, ftaRows: prefData.size, noFtaRows: hs6Codes.length * destinations.length - prefData.size },
      });
    }

    await db.update(ingestionRuns)
      .set({ status: 'succeeded', finishedAt: new Date(), rowsUpserted: totalMfnUpserted + totalPrefUpserted })
      .where(eq(ingestionRuns.id, ingestionRunId));

    logger.info('WTO MFN loader complete', {
      ingestionRunId, phase: 'done',
      meta: {
        chaptersProcessed: chaptersDone - totalChaptersSkipped,
        chaptersSkipped:   totalChaptersSkipped,
        mfnUpserted:       totalMfnUpserted,
        prefUpserted:      totalPrefUpserted,
        scd2:              tally,   // { inserted, verified, versioned }
      },
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
