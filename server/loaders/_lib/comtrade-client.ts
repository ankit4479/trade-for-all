/**
 * UN Comtrade API client — singleton, rate-limited.
 * All Comtrade calls in all loaders go through this one instance.
 *
 * Documented limits (comtradeapi.un.org, Free Token):
 *   - 500 calls/day (binding constraint — daily budget, not per-second)
 *   - Up to 100,000 records per request (use batching to stay within 1 call)
 *   - No documented per-second limit; 1 req/s used as a polite default
 *   - Reporter codes: M49 (NOT ISO-3166) — e.g. USA=842, India=699
 *   - Supports batching: multiple cmdCode and reporterCode comma-separated
 */
import { RateLimitedClient, CallOptions, ApiResponse } from './rate-limiter';
import { createLogger } from './logger';

const logger = createLogger('comtrade-client');

const client = new RateLimitedClient(
  {
    apiName:          'comtrade',
    requestsPerSec:   1,      // polite default — no documented per-second limit
    maxPerDay:        500,    // free token hard limit (comtradeapi.un.org)
    maxRetries:       3,
    backoffBaseMs:    2000,
    circuitThreshold: 10,
    timeoutMs:        45000,
  },
  logger,
);

const BASE_URL = 'https://comtradeapi.un.org/data/v1/get/C/A/HS';
const REF_URL  = 'https://comtradeapi.un.org/files/v1/app/reference/HS.json';

export interface ComtradeCallOptions {
  reporterCode:    string;   // M49 numeric e.g. '842' for USA
  partnerCode?:    string;   // M49 numeric, '0' = world total
  cmdCode?:        string;   // HS code(s), comma-separated for batching
  flowCode?:       string;   // 'M' (import) | 'X' (export)
  period:          string;   // year e.g. '2023'
  loaderName:      string;
  ingestionRunId?: string;
  hsCode?:         string;   // for logging context
}

export interface ComtradeRow {
  reporterCode:    number;
  partnerCode:     number;
  cmdCode:         string;
  flowCode:        string;
  period:          number;
  primaryValue:    number | null;
  netWgt:          number | null;
  qty:             number | null;
  qtyUnitAbbr:     string | null;
}

export interface ComtradeResponse {
  status:   number;
  data:     ComtradeRow[];
}

export async function comtradeFetch(opts: ComtradeCallOptions): Promise<ComtradeResponse> {
  const params = new URLSearchParams({
    reporterCode: opts.reporterCode,
    period:       opts.period,
    partnerCode:  opts.partnerCode ?? '0',
    flowCode:     opts.flowCode ?? 'M',
  });
  if (opts.cmdCode) params.set('cmdCode', opts.cmdCode);

  const url = `${BASE_URL}?${params}`;

  const callOpts: CallOptions = {
    url,
    headers: {
      'Ocp-Apim-Subscription-Key': process.env.UN_COMTRADE_API_KEY ?? '',
      'Accept': 'application/json',
    },
    loaderName:     opts.loaderName,
    ingestionRunId: opts.ingestionRunId,
    hsCode:         opts.hsCode,
  };

  const res: ApiResponse = await client.call(callOpts);
  const body = res.data as { data?: ComtradeRow[] };

  return {
    status: res.status,
    data:   body.data ?? [],
  };
}

export interface HsReferenceRow {
  id:     string;
  text:   string;
  parent: string;
}

export async function comtradeHsReference(loaderName: string): Promise<HsReferenceRow[]> {
  const callOpts: CallOptions = {
    url:       REF_URL,
    headers: {
      'Ocp-Apim-Subscription-Key': process.env.UN_COMTRADE_API_KEY ?? '',
      'Accept': 'application/json',
    },
    loaderName,
  };

  const res: ApiResponse = await client.call(callOpts);
  const body = res.data as { results?: HsReferenceRow[] };
  return body.results ?? [];
}
