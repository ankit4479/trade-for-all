/**
 * Loader 1 — HS Codes
 * Populates: hs_codes
 * Source: UN Comtrade HS reference file (1 API call → ~6,940 rows)
 * Run: npm run db:load:hs
 *
 * Must run before any other loader — all other tables reference hs_code.
 */
import 'dotenv/config';
import { db, sql as pgSql } from '../db/index';
import { hsCodes, ingestionRuns, sources } from '../db/schema';
import { createLogger } from './_lib/logger';
import { comtradeHsReference } from './_lib/comtrade-client';
import { computeFreshness } from './_lib/freshness';
import { eq, sql } from 'drizzle-orm';

const LOADER_NAME  = 'hs-codes';
const HS_EDITION   = 'HS2022';

const logger = createLogger(LOADER_NAME);

async function run(): Promise<void> {
  logger.info('Starting HS codes loader', { phase: 'init', tableAffected: 'hs_codes' });

  // Resolve source row
  const [source] = await db
    .select()
    .from(sources)
    .where(eq(sources.layer, 'hs_nomenclature'))
    .limit(1);

  if (!source) throw new Error('Source row for hs_nomenclature not found — run db:seed first');

  // Open ingestion run
  const [run] = await db.insert(ingestionRuns).values({
    sourceId: source.id,
    status:   'running',
  }).returning();

  const ingestionRunId = run.id;
  logger.info('Ingestion run opened', { ingestionRunId, phase: 'init' });

  try {
    logger.info('Fetching HS reference from Comtrade', {
      ingestionRunId, phase: 'fetch', tableAffected: 'hs_codes',
      apiName: 'comtrade',
    });

    const rows = await comtradeHsReference(LOADER_NAME);

    logger.info(`Fetched ${rows.length} HS reference rows`, {
      ingestionRunId, phase: 'transform',
      meta: { totalRows: rows.length },
    });

    // Transform: derive level and parentCode from code length
    const { staleAt, expiresAt } = computeFreshness('static');
    const fetchedAt = new Date();

    const values = rows
      .filter((r) => r.id && r.id !== '-1' && r.parent !== undefined)
      .map((r) => {
        const code = r.id.trim();
        const level = code.length === 2 ? 2 : code.length === 4 ? 4 : 6;
        const parentCode = r.parent === '-1' ? null : r.parent.trim() || null;

        return {
          code,
          hsEdition:   HS_EDITION,
          description: r.text?.trim() ?? '',
          level,
          parentCode,
          fetchedAt,
          expiresAt,
        };
      })
      .filter((r) => [2, 4, 6].includes(r.level));

    logger.info(`Upserting ${values.length} hs_codes rows`, {
      ingestionRunId, phase: 'upsert', tableAffected: 'hs_codes',
      meta: {
        chapters:    values.filter((r) => r.level === 2).length,
        headings:    values.filter((r) => r.level === 4).length,
        subheadings: values.filter((r) => r.level === 6).length,
      },
    });

    // Batch upsert in chunks of 500
    const CHUNK = 500;
    let upserted = 0;

    for (let i = 0; i < values.length; i += CHUNK) {
      const chunk = values.slice(i, i + CHUNK);
      await db
        .insert(hsCodes)
        .values(chunk)
        .onConflictDoUpdate({
          target: [hsCodes.code, hsCodes.hsEdition],
          set: {
            description: sql`excluded.description`,
            level:       sql`excluded.level`,
            parentCode:  sql`excluded.parent_code`,
            fetchedAt:   sql`excluded.fetched_at`,
            expiresAt:   sql`excluded.expires_at`,
          },
        });
      upserted += chunk.length;
      logger.info(`Upserted ${upserted}/${values.length}`, {
        ingestionRunId, phase: 'upsert', tableAffected: 'hs_codes',
        rowsAffected: chunk.length,
      });
    }

    // Close ingestion run
    await db.update(ingestionRuns)
      .set({ status: 'succeeded', finishedAt: new Date(), rowsUpserted: upserted })
      .where(eq(ingestionRuns.id, ingestionRunId));

    logger.info(`HS codes loader complete — ${upserted} rows upserted`, {
      ingestionRunId, phase: 'done', tableAffected: 'hs_codes', rowsAffected: upserted,
    });

  } catch (err) {
    const errorDetail = err instanceof Error ? err.message : String(err);
    logger.error('HS codes loader failed', {
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
  console.error('[hs-codes] Fatal error:', err);
  process.exit(1);
});
