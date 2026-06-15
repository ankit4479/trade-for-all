/**
 * WTO Timeseries API client — singleton, rate-limited.
 * All WTO calls in all loaders go through this one instance.
 *
 * Documented limits (apiportal.wto.org, TimeSeries product):
 *   - Timeseries data endpoints: 1 call/second
 *   - General ceiling: 10,000 calls/hour
 *   - HS_P_0070 returns 204 when no FTA exists (not an error)
 *   - Bound rate indicators: omit ps= (no time dimension)
 *   - Reporter codes: ISO-3166 numeric (WTO) ≠ M49 (Comtrade)
 */
import { RateLimitedClient, CallOptions, ApiResponse } from './rate-limiter';
import { createLogger } from './logger';

const logger = createLogger('wto-client');

const client = new RateLimitedClient(
  {
    apiName:          'wto',
    requestsPerSec:   1,      // timeseries endpoint limit (portal-documented)
    maxPerHour:       10000,  // general WTO ceiling
    maxRetries:       3,
    backoffBaseMs:    3000,
    circuitThreshold: 10,
    timeoutMs:        30000,
  },
  logger,
);

const BASE_URL = 'https://api.wto.org/timeseries/v1/data';

export interface WtoCallOptions {
  indicator:      string;   // e.g. 'HS_A_0010'
  reporter:       string;   // WTO ISO-3166 numeric e.g. '840', or comma-separated batch
  productCode?:   string;   // pc= param: single HS code or comma-separated batch
  year?:          number;   // ps= param: omit for indicators with no time dimension
  loaderName:     string;
  ingestionRunId?: string;
  reporterCode?:  string;   // our jurisdiction code e.g. 'US' (for logging, single calls)
  partnerCode?:   string;
  logHsCode?:     string;   // override what gets logged as hsCode (e.g. 'ch09' for batch calls)
}

export interface WtoDataset {
  ReportingEconomyCode: string;
  ProductOrSectorCode:  string;
  Year:                 number | null;
  Value:                number | null;
  ValueFlagCode:        string | null;
}

export interface WtoResponse {
  status:  number;
  dataset: WtoDataset[];
}

export async function wtoFetch(opts: WtoCallOptions): Promise<WtoResponse> {
  const params = new URLSearchParams({
    i:    opts.indicator,
    r:    opts.reporter,
    fmt:  'json',
    mode: 'full',
  });
  if (opts.productCode) params.set('pc', opts.productCode);
  if (opts.year)        params.set('ps', String(opts.year));

  const url = `${BASE_URL}?${params}`;

  const callOpts: CallOptions = {
    url,
    headers: {
      'Ocp-Apim-Subscription-Key': process.env.WTO_API_KEY ?? '',
      'Accept': 'application/json',
    },
    loaderName:     opts.loaderName,
    ingestionRunId: opts.ingestionRunId,
    reporterCode:   opts.reporterCode,
    partnerCode:    opts.partnerCode,
    hsCode:         opts.logHsCode ?? opts.productCode,
    indicator:      opts.indicator,
    year:           opts.year,
  };

  const res: ApiResponse = await client.call(callOpts);

  if (res.status === 204 || res.data === null) {
    return { status: 204, dataset: [] };
  }

  const body = res.data as { Dataset?: WtoDataset[] };
  return {
    status:  res.status,
    dataset: body.Dataset ?? [],
  };
}
