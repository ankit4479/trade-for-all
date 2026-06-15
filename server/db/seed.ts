/**
 * Phase-1 seed — reference rows the FKs depend on.
 * Run: npm run db:seed   (idempotent — upserts on conflict)
 *
 * Seeds:
 *   - jurisdictions: IN (origin) + US/EU/UK/AE/AU (targets) + EU/GCC blocs + WORLD sentinel
 *   - sources: the WTO/UN registry rows for HS nomenclature + tariffs
 *
 * NOTE on numeric codes: iso_numeric is the ISO 3166-1 numeric (stable).
 * Comtrade and WTO use their OWN country-code lists that differ from ISO
 * (e.g. Comtrade India=699, USA=842). Those go in `api_codes` and are filled
 * when each loader is wired — we do NOT guess them here.
 */
import 'dotenv/config';
import { db, sql } from './index';
import { jurisdictions, sources } from './schema';

async function seed() {
  console.log('[seed] jurisdictions…');
  await db
    .insert(jurisdictions)
    .values([
      // origin
      { code: 'IN', kind: 'country', name: 'India', isoNumeric: '356', appliesVat: true },
      // targets (countries)
      { code: 'US', kind: 'country', name: 'United States', isoNumeric: '840', appliesVat: false }, // no federal VAT
      { code: 'GB', kind: 'country', name: 'United Kingdom', isoNumeric: '826', appliesVat: true },
      { code: 'AU', kind: 'country', name: 'Australia', isoNumeric: '036', appliesVat: true },
      { code: 'AE', kind: 'country', name: 'United Arab Emirates', isoNumeric: '784', appliesVat: true },
      // blocs (customs unions — duty attaches here)
      { code: 'EU', kind: 'bloc', name: 'European Union', isoNumeric: null, isCustomsUnion: true, appliesVat: false },
      { code: 'GCC', kind: 'bloc', name: 'Gulf Cooperation Council', isoNumeric: null, isCustomsUnion: true, appliesVat: false },
      // MFN baseline sentinel (partner = WORLD)
      { code: 'WORLD', kind: 'world', name: 'World (MFN baseline)', isoNumeric: null, appliesVat: false },
    ])
    .onConflictDoNothing({ target: jurisdictions.code });

  console.log('[seed] sources…');
  await db
    .insert(sources)
    .values([
      {
        name: 'UN/WCO HS 2022 nomenclature',
        url: 'https://comtradeapi.un.org/files/v1/app/reference/HS.json',
        jurisdictionCode: 'WORLD',
        layer: 'hs_nomenclature',
        accessMethod: 'api',
        reliabilityTier: 'authoritative_api',
        volatilityClass: 'static',
        notes: 'HS6 code tree + descriptions. Refresh yearly; real change ~5yr (edition).',
      },
      {
        name: 'WTO Tariff & Trade Data (TTD) bulk',
        url: 'https://ttd.wto.org/en/download/six-digit',
        watchUrl: 'https://ttd.wto.org/en/download',
        jurisdictionCode: 'WORLD',
        layer: 'duty_mfn',
        accessMethod: 'bulk_file',
        reliabilityTier: 'official_file',
        volatilityClass: 'annual',
        notes: 'Bound + MFN applied + preferential + trade value, HS6, per reporter. CSV. Quarterly re-check.',
      },
      {
        name: 'WTO Tariff API (incremental)',
        url: 'https://api.wto.org/tariff/v1/tariff',
        jurisdictionCode: 'WORLD',
        layer: 'duty_mfn',
        accessMethod: 'api',
        reliabilityTier: 'authoritative_api',
        volatilityClass: 'annual',
        notes: 'Per reporter+HS6 top-ups. Needs Ocp-Apim-Subscription-Key (WTO_API_KEY).',
      },
      {
        name: 'UN Comtrade (trade flows)',
        url: 'https://comtradeapi.un.org/data/v1/get/C/A/HS',
        jurisdictionCode: 'WORLD',
        layer: 'trade_flow',
        accessMethod: 'api',
        reliabilityTier: 'aggregator',
        volatilityClass: 'annual',
        notes: 'Demand aggregates only (top importers per HS6). Cache, do NOT mirror. Needs UN_COMTRADE_API_KEY.',
      },
    ])
    .onConflictDoNothing();

  const jCount = await db.$count(jurisdictions);
  const sCount = await db.$count(sources);
  console.log(`[seed] done. jurisdictions=${jCount} sources=${sCount}`);
  await sql.end();
}

seed().catch((e) => {
  console.error('[seed] failed:', e);
  process.exit(1);
});
