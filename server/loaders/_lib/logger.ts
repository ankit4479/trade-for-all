/**
 * Shared logger — console (pino) + async DB transport.
 * Every loader and API client uses this. Never import pino directly.
 *
 * Design: DB writes are fire-and-forget. A failure writing to pipeline_logs
 * never crashes the loader — it logs to stderr and continues.
 */
import pino from 'pino';
import { db } from '../../db/index';
import { pipelineLogs } from '../../db/schema';

const isProduction = process.env.NODE_ENV === 'production';

const consoleLogger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: isProduction
    ? undefined
    : { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } },
});

export interface LogContext {
  ingestionRunId?: string;
  phase?: string;
  tableAffected?: string;
  apiName?: string;
  apiUrl?: string;
  httpStatus?: number;
  durationMs?: number;
  attemptNumber?: number;
  reporterCode?: string;
  partnerCode?: string;
  hsCode?: string;
  indicator?: string;
  year?: number;
  rowsAffected?: number;
  errorCode?: string;
  errorDetail?: string;
  meta?: Record<string, unknown>;
}

type Level = 'debug' | 'info' | 'warn' | 'error';

async function writeToDb(
  loaderName: string,
  level: Level,
  message: string,
  ctx: LogContext,
): Promise<void> {
  try {
    await db.insert(pipelineLogs).values({
      ingestionRunId: ctx.ingestionRunId ?? null,
      loaderName,
      level,
      message,
      phase: ctx.phase ?? null,
      tableAffected: ctx.tableAffected ?? null,
      apiName: ctx.apiName ?? null,
      apiUrl: ctx.apiUrl ?? null,
      httpStatus: ctx.httpStatus ?? null,
      durationMs: ctx.durationMs ?? null,
      attemptNumber: ctx.attemptNumber ?? null,
      reporterCode: ctx.reporterCode ?? null,
      partnerCode: ctx.partnerCode ?? null,
      hsCode: ctx.hsCode ?? null,
      indicator: ctx.indicator ?? null,
      year: ctx.year ?? null,
      rowsAffected: ctx.rowsAffected ?? null,
      errorCode: ctx.errorCode ?? null,
      errorDetail: ctx.errorDetail ?? null,
      meta: ctx.meta ?? null,
    });
  } catch (err) {
    // Never crash the loader because of a logging failure
    process.stderr.write(`[logger] DB write failed: ${String(err)}\n`);
  }
}

export interface Logger {
  debug: (message: string, ctx?: LogContext) => void;
  info:  (message: string, ctx?: LogContext) => void;
  warn:  (message: string, ctx?: LogContext) => void;
  error: (message: string, ctx?: LogContext) => void;
}

export function createLogger(loaderName: string): Logger {
  function log(level: Level, message: string, ctx: LogContext = {}): void {
    const logData = { loader: loaderName, ...ctx };

    // Synchronous console output
    consoleLogger[level](logData, message);

    // Async DB write — intentionally not awaited
    writeToDb(loaderName, level, message, ctx).catch(() => {});
  }

  return {
    debug: (msg, ctx) => log('debug', msg, ctx),
    info:  (msg, ctx) => log('info',  msg, ctx),
    warn:  (msg, ctx) => log('warn',  msg, ctx),
    error: (msg, ctx) => log('error', msg, ctx),
  };
}
