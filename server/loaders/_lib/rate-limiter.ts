/**
 * RateLimitedClient — Option A (token bucket per API instance).
 * Enforces minimum spacing between calls, retries on 429/5xx with
 * exponential backoff, circuit-breaks after consecutive failures.
 *
 * One singleton instance per API (wto-client.ts, comtrade-client.ts).
 * All callers share the same lastCallAt, so concurrent loaders never
 * race each other on the same API.
 */
import { Logger, LogContext } from './logger';

export interface RateLimiterConfig {
  apiName:           string;
  minSpacingMs:      number;  // minimum ms between calls
  maxRetries:        number;  // attempts before giving up (1 = no retry)
  backoffBaseMs:     number;  // first retry wait; doubles each attempt
  circuitThreshold:  number;  // consecutive errors before circuit opens
  timeoutMs:         number;  // per-call timeout
}

export interface CallOptions {
  url:           string;
  headers:       Record<string, string>;
  loaderName:    string;
  ingestionRunId?: string;
  // Data context for logging
  reporterCode?: string;
  partnerCode?:  string;
  hsCode?:       string;
  indicator?:    string;
  year?:         number;
}

export interface ApiResponse {
  status:  number;
  data:    unknown;
}

export class RateLimitedClient {
  private lastCallAt    = 0;
  private consecutiveErrors = 0;
  private circuitOpen   = false;

  constructor(
    private readonly config: RateLimiterConfig,
    private readonly logger: Logger,
  ) {}

  async call(opts: CallOptions): Promise<ApiResponse> {
    if (this.circuitOpen) {
      throw new Error(`[${this.config.apiName}] Circuit breaker open — too many consecutive errors`);
    }

    let attempt = 0;

    while (attempt < this.config.maxRetries) {
      attempt++;
      await this.enforceSpacing();

      const start = Date.now();
      const logCtx: LogContext = {
        ingestionRunId: opts.ingestionRunId,
        phase:          'fetch',
        apiName:        this.config.apiName,
        apiUrl:         opts.url,
        attemptNumber:  attempt,
        reporterCode:   opts.reporterCode,
        partnerCode:    opts.partnerCode,
        hsCode:         opts.hsCode,
        indicator:      opts.indicator,
        year:           opts.year,
      };

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

        const res = await fetch(opts.url, {
          headers: opts.headers,
          signal: controller.signal,
        });
        clearTimeout(timer);

        const durationMs = Date.now() - start;
        this.lastCallAt = Date.now();

        if (res.status === 200 || res.status === 204) {
          this.consecutiveErrors = 0;
          const data = res.status === 204 ? null : await res.json();

          this.logger.info(`${this.config.apiName} ${res.status}`, {
            ...logCtx,
            httpStatus: res.status,
            durationMs,
          });

          return { status: res.status, data };
        }

        // 400 = bad request / no data for this combination — not retryable, return as-is
        if (res.status === 400) {
          this.consecutiveErrors = 0;
          this.logger.warn(`${this.config.apiName} 400 — no data for this combination`, {
            ...logCtx, httpStatus: 400, durationMs, errorCode: 'bad_request',
          });
          return { status: 400, data: null };
        }

        if (res.status === 429 || res.status >= 500) {
          const waitMs = this.config.backoffBaseMs * Math.pow(2, attempt - 1);
          this.logger.warn(`${this.config.apiName} ${res.status} — retry ${attempt}/${this.config.maxRetries} in ${waitMs}ms`, {
            ...logCtx,
            httpStatus:  res.status,
            durationMs,
            errorCode:   res.status === 429 ? 'rate_limited' : 'server_error',
          });

          if (attempt < this.config.maxRetries) {
            await sleep(waitMs);
            continue;
          }
        }

        // Non-retryable HTTP error
        this.recordError();
        const errorDetail = `HTTP ${res.status}`;
        this.logger.error(`${this.config.apiName} non-retryable error`, {
          ...logCtx,
          httpStatus:  res.status,
          durationMs,
          errorCode:   'http_error',
          errorDetail,
        });
        throw new Error(errorDetail);

      } catch (err: unknown) {
        const durationMs = Date.now() - start;
        this.lastCallAt = Date.now();

        if (err instanceof Error && err.name === 'AbortError') {
          this.logger.warn(`${this.config.apiName} timeout after ${this.config.timeoutMs}ms — retry ${attempt}`, {
            ...logCtx, durationMs, errorCode: 'timeout',
          });
          if (attempt < this.config.maxRetries) {
            await sleep(this.config.backoffBaseMs * attempt);
            continue;
          }
        }

        this.recordError();
        const errorDetail = err instanceof Error ? err.message : String(err);
        this.logger.error(`${this.config.apiName} call failed`, {
          ...logCtx, durationMs, errorCode: 'fetch_error', errorDetail,
        });
        throw err;
      }
    }

    this.recordError();
    throw new Error(`${this.config.apiName} max retries (${this.config.maxRetries}) exceeded for ${opts.url}`);
  }

  private async enforceSpacing(): Promise<void> {
    const elapsed = Date.now() - this.lastCallAt;
    const wait = this.config.minSpacingMs - elapsed;
    if (wait > 0) await sleep(wait);
  }

  private recordError(): void {
    this.consecutiveErrors++;
    if (this.consecutiveErrors >= this.config.circuitThreshold) {
      this.circuitOpen = true;
      this.logger.error(
        `${this.config.apiName} circuit breaker OPEN after ${this.consecutiveErrors} consecutive errors`,
        { errorCode: 'circuit_open' },
      );
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
