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
      { code: 'IN', kind: 'country', name: 'India', isoNumeric: '356', appliesVat: true,
        apiCodes: { wto: '356', comtrade: '699' } },
      // targets (countries)
      { code: 'US', kind: 'country', name: 'United States', isoNumeric: '840', appliesVat: false,
        apiCodes: { wto: '840', comtrade: '842' } },
      { code: 'GB', kind: 'country', name: 'United Kingdom', isoNumeric: '826', appliesVat: true,
        apiCodes: { wto: '826', comtrade: '826' } },
      { code: 'AU', kind: 'country', name: 'Australia', isoNumeric: '036', appliesVat: true,
        apiCodes: { wto: '036', comtrade: '36' } },
      { code: 'AE', kind: 'country', name: 'United Arab Emirates', isoNumeric: '784', appliesVat: true,
        apiCodes: { wto: '784', comtrade: '784' } },
      // blocs (customs unions — duty attaches at bloc level)
      { code: 'EU', kind: 'bloc', name: 'European Union', isoNumeric: null, isCustomsUnion: true, appliesVat: false,
        apiCodes: { wto: '97', comtrade: '97' } },
      { code: 'GCC', kind: 'bloc', name: 'Gulf Cooperation Council', isoNumeric: null, isCustomsUnion: true, appliesVat: false,
        apiCodes: {} },
      // MFN baseline sentinel (partner = WORLD means no preferential agreement)
      { code: 'WORLD', kind: 'world', name: 'World (MFN baseline)', isoNumeric: null, appliesVat: false,
        apiCodes: { wto: '0', comtrade: '0' } },
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
        name: 'WTO Timeseries API (MFN + preferential)',
        url: 'https://api.wto.org/timeseries/v1/data',
        jurisdictionCode: 'WORLD',
        layer: 'duty_mfn',
        accessMethod: 'api',
        reliabilityTier: 'authoritative_api',
        volatilityClass: 'annual',
        notes: 'Indicators: HS_A_0010/0020/0030/0040/0050 (MFN), HS_P_0070 (pref), TP_A_* (profiles). Needs WTO_API_KEY.',
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
