/**
 * Loader 4 — WTO Preferential Rates (world-scope, chapter-batched)
 * Populates: hs_preferential_rates
 * Source: WTO Timeseries API — indicator HS_P_0070
 * Run: npm run db:load:pref
 *
 * Strategy:
 *   - r= batches all 5 destination reporters in one call.
 *   - pc= batches all HS-6 codes in the chapter.
 *   - NO ps= (year) parameter: HS_P_0070 has no time dimension — adding ps=
 *     causes WTO to return 204. Store the Year from each response row.
 *   - c=5000 overrides the default 500-row cap.
 *   - Paginates with page=2, page=3 … when response has exactly 5000 rows.
 *   - Only stores rows where WTO returned data — absence = no FTA, pay MFN.
 *   - partner_code stored as WTO numeric (e.g. '356' India, '156' China).
 *
 * Total: 98 chapters × 1 call = ~98 calls at 1 req/s ≈ 2 minutes.
 *
 * Resumability: skip chapter if any pref rows for that chapter are fresh in DB.
 * Single chapter mode: HS_CHAPTER=09 npm run db:load:pref
 */
import 'dotenv/config';
import { db, sql as pgSql } from '../db/index';
import {
  hsPreferentialRates, hsCodes,
  ingestionRuns, jurisdictions, sources,
} from '../db/schema';
import { createLogger } from './_lib/logger';
import { wtoFetch, WtoDataset } from './_lib/wto-client';
import { computeFreshness } from './_lib/freshness';
import { scd2Upsert, Scd2Result } from './_lib/scd2';
import { eq, and, gt, count, sql } from 'drizzle-orm';

const LOADER_NAME = 'wto-pref';
const PAGE_SIZE   = 5000;   // matches c=5000 cap — paginate when rows == PAGE_SIZE

const logger = createLogger(LOADER_NAME);

async function run(): Promise<void> {
  const singleChapter = process.env.HS_CHAPTER ?? null;

  logger.info('Starting WTO preferential rates loader (world-scope, chapter-batched)', {
    phase: 'init',
    meta: { singleChapter, strategy: 'chapter_batch_no_year_dim' },
  });

  // ── Destination reporters ─────────────────────────────────────────────────
  const allJurisdictions = await db.select().from(jurisdictions);
  const destinations = allJurisdictions.filter((j) => {
    const apiCodes = j.apiCodes as Record<string, string>;
    return j.code !== 'IN' && j.code !== 'WORLD' && j.code !== 'GCC' && apiCodes?.['wto'];
  });

  const reporterCodes = destinations.map((j) =>
    (j.apiCodes as Record<string, string>)['wto'].padStart(3, '0'),
  );
  const reporterParam = reporterCodes.join(',');

  // Map WTO numeric → our jurisdiction code (for reporterCode column)
  const wtoToCode = new Map(
    destinations.map((j) => [
      (j.apiCodes as Record<string, string>)['wto'].padStart(3, '0'),
      j.code,
    ]),
  );

  logger.info(`Reporters: ${reporterParam}`, { phase: 'init' });

  // ── HS-6 codes grouped by chapter ────────────────────────────────────────
  const allHs6 = await db.select({ code: hsCodes.code }).from(hsCodes)
    .where(eq(hsCodes.level, 6));

  const byChapter = new Map<string, string[]>();
  for (const { code } of allHs6) {
    const chapter = code.slice(0, 2);
    if (singleChapter && chapter !== singleChapter) continue;
    const list = byChapter.get(chapter) ?? [];
    list.push(code);
    byChapter.set(chapter, list);
  }

  const chapters = [...byChapter.keys()].sort();
  if (chapters.length === 0) throw new Error('No HS-6 codes — run db:load:hs first');

  logger.info(`Processing ${chapters.length} chapters, ${allHs6.length} HS-6 codes`, {
    phase: 'init',
    meta: { chapterCount: chapters.length, hs6Count: allHs6.length },
  });

  // ── Source + ingestion run ────────────────────────────────────────────────
  const [source] = await db.select().from(sources)
    .where(eq(sources.layer, 'duty_preferential')).limit(1);
  if (!source) throw new Error('Source row for duty_preferential not found — run db:seed first');

  const [run] = await db.insert(ingestionRuns).values({
    sourceId: source.id, status: 'running',
  }).returning();
  const ingestionRunId = run.id;

  const { staleAt, expiresAt } = computeFreshness('annual');
  const fetchedAt = new Date();
  let totalUpserted     = 0;
  let totalChaptersSkipped = 0;
  let chaptersDone      = 0;
  // SCD-2 outcome tally — proves versioning is working at a glance.
  const tally: Record<Scd2Result, number> = { inserted: 0, verified: 0, versioned: 0 };

  try {
    for (const chapter of chapters) {
      chaptersDone++;
      const hs6Codes = byChapter.get(chapter)!;
      const pcParam  = hs6Codes.join(',');

      // ── Freshness check ───────────────────────────────────────────────────
      const now = new Date();
      const [freshCheck] = await db.select({ fresh: count() })
        .from(hsPreferentialRates)
        .where(and(
          sql`LEFT(${hsPreferentialRates.hsCode}, 2) = ${chapter}`,
          gt(hsPreferentialRates.expiresAt, now),
        ));

      if (freshCheck && Number(freshCheck.fresh) > 0) {
        logger.info(`[${chaptersDone}/${chapters.length}] SKIP chapter ${chapter} — ${freshCheck.fresh} fresh pref rows in DB`, {
          ingestionRunId, phase: 'skip',
          meta: { chapter, freshRows: Number(freshCheck.fresh) },
        });
        totalChaptersSkipped++;
        continue;
      }

      logger.info(`[${chaptersDone}/${chapters.length}] FETCH chapter ${chapter} (${hs6Codes.length} HS-6, p=all)`, {
        ingestionRunId, phase: 'fetch',
        meta: { chapter, hs6Count: hs6Codes.length, reporters: reporterParam },
      });

      // ── Paginated fetch: p=all, c=5000 ───────────────────────────────────
      const allRows: WtoDataset[] = [];
      let page = 1;

      while (true) {
        const extraParams: Record<string, string> = { c: String(PAGE_SIZE) };
        if (page > 1) extraParams['page'] = String(page);

        // No ps= (year): HS_P_0070 has no time dimension — adding it returns 204
        const res = await wtoFetch({
          indicator:      'HS_P_0070',
          reporter:       reporterParam,
          productCode:    pcParam,
          loaderName:     LOADER_NAME,
          ingestionRunId,
          logHsCode:      `ch${chapter}${page > 1 ? `/p${page}` : ''}`,
          extraParams,
        });

        if (res.status === 204 || res.dataset.length === 0) break;

        allRows.push(...res.dataset);

        // If exactly PAGE_SIZE rows returned, there may be more — fetch next page
        if (res.dataset.length < PAGE_SIZE) break;
        page++;
      }

      if (allRows.length === 0) {
        logger.info(`Chapter ${chapter}: no FTA data (no WTO members grant preferences on these HS codes)`, {
          ingestionRunId, phase: 'skip', meta: { chapter },
        });
        continue;
      }

      logger.info(`Chapter ${chapter}: ${allRows.length} FTA rows fetched (${page} page(s))`, {
        ingestionRunId, phase: 'fetch', meta: { chapter, rows: allRows.length, pages: page },
      });

      // ── Upsert only rows that came back (no placeholder rows) ────────────
      let chapterUpserted = 0;
      for (const row of allRows) {
        const wtoReporter  = row.ReportingEconomyCode.padStart(3, '0');
        const reporterCode = wtoToCode.get(wtoReporter);
        if (!reporterCode) continue;  // not one of our 5 destinations

        const partnerCode = String(row.PartnerEconomyCode ?? row.PartnerCode ?? '').padStart(3, '0');
        if (!partnerCode || partnerCode === '000') continue;

        // HS_P_0070 has no time dimension: use the year from the response, not a fixed year
        const rowYear = row.Year ?? 2019;

        const result = await scd2Upsert({
          table:      hsPreferentialRates,
          naturalKey: and(
            eq(hsPreferentialRates.reporterCode, reporterCode),
            eq(hsPreferentialRates.partnerCode, partnerCode),
            eq(hsPreferentialRates.hsCode, row.ProductOrSectorCode),
            eq(hsPreferentialRates.hsEdition, 'HS2022'),
            eq(hsPreferentialRates.year, rowYear),
          )!,
          valueFields: { simpleAvgPct: row.Value, coverageStatus: 'available' },
          staticFields: {
            reporterCode, partnerCode, hsCode: row.ProductOrSectorCode,
            hsEdition: 'HS2022', year: rowYear, sourceId: source.id,
          },
          fetchedAt, staleAt, expiresAt, ingestionRunId,
        });
        tally[result]++;
        chapterUpserted++;
      }

      totalUpserted += chapterUpserted;
      logger.info(`Chapter ${chapter}: ${chapterUpserted} rows upserted`, {
        ingestionRunId, phase: 'upsert', tableAffected: 'hs_preferential_rates',
        meta: { chapter, rows: chapterUpserted },
      });
    }

    await db.update(ingestionRuns)
      .set({ status: 'succeeded', finishedAt: new Date(), rowsUpserted: totalUpserted })
      .where(eq(ingestionRuns.id, ingestionRunId));

    logger.info('WTO preferential loader complete', {
      ingestionRunId, phase: 'done',
      meta: {
        chaptersProcessed: chaptersDone - totalChaptersSkipped,
        chaptersSkipped:   totalChaptersSkipped,
        totalUpserted,
        scd2:              tally,   // { inserted, verified, versioned }
      },
    });

  } catch (err) {
    const errorDetail = err instanceof Error ? err.message : String(err);
    logger.error('WTO preferential loader failed', {
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
  console.error('[wto-pref] Fatal error:', err);
  process.exit(1);
});
