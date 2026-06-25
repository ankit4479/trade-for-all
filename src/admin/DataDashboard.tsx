/**
 * DataDashboard — the internal, read-only data dashboard (dev-only).
 * ------------------------------------------------------------------
 * Two-pane introspection UI over `/api/admin/*`. Left: table list (sidebar).
 * Right: schema panel + auto-generated filters + paginated/sortable grid +
 * row-detail drawer.
 *
 * Owns ALL state. Key behaviours:
 *  - Token gate: no token or a 401 → token prompt (saved to localStorage).
 *  - Filters reset on table change; persist across paging/sort.
 *  - Stale-fetch safety: each rows/schema load carries a monotonically
 *    increasing request id; only the latest result is committed. An
 *    AbortController also cancels the in-flight fetch on rapid table switches.
 *    Together these survive React StrictMode's double-invoke in dev.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Database, Table2, RefreshCw, AlertTriangle, KeyRound, LogOut } from 'lucide-react';
import type { TableSummary, TableSchema, Filter, RowsResponse } from './types';
import {
  listTables,
  getSchema,
  getRows,
  getToken,
  setToken,
  clearToken,
  UnauthorizedError,
} from './api';
import { SchemaPanel } from './SchemaPanel';
import { FilterBar } from './FilterBar';
import { DataGrid } from './DataGrid';
import { RowDetailDrawer } from './RowDetailDrawer';

const PAGE_SIZE = 50;

export const DataDashboard: React.FC = () => {
  /* ── auth ──────────────────────────────────────────────────────────────── */
  const [hasToken, setHasToken] = useState<boolean>(() => !!getToken());
  const [tokenInput, setTokenInput] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  /* ── sidebar ───────────────────────────────────────────────────────────── */
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [tablesError, setTablesError] = useState<string | null>(null);

  /* ── selected table ────────────────────────────────────────────────────── */
  const [selected, setSelected] = useState<string | null>(null);
  const [schema, setSchema] = useState<TableSchema | null>(null);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [sort, setSort] = useState<string | null>(null);
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  const [drawerRow, setDrawerRow] = useState<Record<string, unknown> | null>(null);

  // Monotonic request id — only the latest rows request commits its result.
  const rowsReqId = useRef(0);
  const rowsAbort = useRef<AbortController | null>(null);

  /* ── 401 handling: any call that 401s drops us back to the token prompt. ── */
  const handle401 = useCallback(() => {
    clearToken();
    setHasToken(false);
    setAuthError('Token rejected. Enter a valid admin token.');
  }, []);

  /* ── load tables (sidebar) ─────────────────────────────────────────────── */
  const loadTables = useCallback(() => {
    setTablesLoading(true);
    setTablesError(null);
    const ctrl = new AbortController();
    listTables(ctrl.signal)
      .then((t) => setTables(t))
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        if (err instanceof UnauthorizedError) return handle401();
        setTablesError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setTablesLoading(false);
      });
    return () => ctrl.abort();
  }, [handle401]);

  useEffect(() => {
    if (!hasToken) return;
    return loadTables();
  }, [hasToken, loadTables]);

  /* ── load a table's schema (on selection) ──────────────────────────────── */
  useEffect(() => {
    if (!selected) return;
    const ctrl = new AbortController();
    setSchema(null);
    setDataError(null);
    getSchema(selected, ctrl.signal)
      .then((s) => {
        if (!ctrl.signal.aborted) setSchema(s);
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        if (err instanceof UnauthorizedError) return handle401();
        setDataError(err instanceof Error ? err.message : String(err));
      });
    return () => ctrl.abort();
  }, [selected, handle401]);

  /* ── load rows (on table / filters / sort / page change) ───────────────── */
  const loadRows = useCallback(() => {
    if (!selected) return;
    const reqId = ++rowsReqId.current;
    rowsAbort.current?.abort();
    const ctrl = new AbortController();
    rowsAbort.current = ctrl;

    setRowsLoading(true);
    setDataError(null);
    getRows(
      selected,
      { page, pageSize: PAGE_SIZE, sort: sort ?? undefined, dir, filters },
      ctrl.signal,
    )
      .then((r: RowsResponse) => {
        // Ignore stale responses: only the latest request id may commit.
        if (reqId !== rowsReqId.current) return;
        setRows(r.rows);
        setTotal(r.total);
      })
      .catch((err) => {
        if (ctrl.signal.aborted || reqId !== rowsReqId.current) return;
        if (err instanceof UnauthorizedError) return handle401();
        setDataError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (reqId === rowsReqId.current) setRowsLoading(false);
      });
  }, [selected, page, sort, dir, filters, handle401]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  /* ── selection / interaction handlers ──────────────────────────────────── */

  const selectTable = (name: string) => {
    if (name === selected) return;
    setSelected(name);
    // Reset filters + sort + page on table change; they persist within a table.
    setFilters([]);
    setSort(null);
    setDir('asc');
    setPage(1);
    setRows([]);
    setTotal(0);
    setDrawerRow(null);
  };

  const handleSort = (column: string) => {
    if (sort === column) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(column);
      setDir('asc');
    }
    setPage(1);
  };

  const applyFilters = (f: Filter[]) => {
    setFilters(f);
    setPage(1);
  };

  const clearFilters = () => {
    setFilters([]);
    setPage(1);
  };

  /** FK click-through: jump to the referenced table, filtered to that value. */
  const followFk = (table: string, column: string, value: unknown) => {
    setSelected(table);
    setSort(null);
    setDir('asc');
    setPage(1);
    setRows([]);
    setTotal(0);
    setDrawerRow(null);
    setFilters([{ column, op: 'eq', value }]);
  };

  const saveToken = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenInput.trim()) return;
    setToken(tokenInput.trim());
    setTokenInput('');
    setAuthError(null);
    setHasToken(true);
  };

  const signOut = () => {
    clearToken();
    setHasToken(false);
    setSelected(null);
    setSchema(null);
    setTables([]);
  };

  /* ── token prompt ──────────────────────────────────────────────────────── */
  if (!hasToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <form onSubmit={saveToken} className="glass-card rounded-3xl p-8 w-full max-w-sm">
          <div className="flex items-center gap-2 mb-1">
            <Database className="w-5 h-5 text-emerald-600" />
            <h1 className="text-lg font-bold gradient-text">Data Dashboard</h1>
          </div>
          <p className="text-sm text-slate-500 mb-6">Internal · read-only · dev only</p>

          <label className="block text-xs font-bold text-slate-600 mb-1">Admin token</label>
          <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-xl border border-slate-200 focus-within:ring-2 focus-within:ring-emerald-200">
            <KeyRound className="w-4 h-4 text-slate-400" />
            <input
              type="password"
              autoFocus
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="x-admin-token"
              className="flex-1 text-sm bg-transparent focus:outline-none"
            />
          </div>
          {authError && <p className="text-xs text-rose-600 mb-3">{authError}</p>}
          <button
            type="submit"
            className="w-full py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700 transition-colors"
          >
            Unlock
          </button>
        </form>
      </div>
    );
  }

  /* ── main two-pane layout ──────────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar. */}
      <aside className="w-64 shrink-0 border-r border-slate-200 bg-white flex flex-col">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <span className="flex items-center gap-2 font-bold text-sm gradient-text">
            <Database className="w-4 h-4 text-emerald-600" /> Data Dashboard
          </span>
          <button
            type="button"
            onClick={signOut}
            className="text-slate-300 hover:text-slate-600"
            aria-label="sign out / clear token"
            title="Clear token"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
          {tablesLoading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-9 mb-1 bg-slate-100 rounded-xl animate-pulse" />
            ))
          ) : tablesError ? (
            <div className="p-3 text-xs text-rose-600">
              <AlertTriangle className="w-4 h-4 mb-1" />
              {tablesError}
              <button
                type="button"
                onClick={loadTables}
                className="mt-2 flex items-center gap-1 text-slate-600 hover:text-slate-900"
              >
                <RefreshCw className="w-3 h-3" /> Retry
              </button>
            </div>
          ) : tables.length === 0 ? (
            <p className="p-3 text-xs text-slate-400">No tables found.</p>
          ) : (
            tables.map((t) => {
              const active = t.tableName === selected;
              return (
                <button
                  key={t.tableName}
                  type="button"
                  onClick={() => selectTable(t.tableName)}
                  className={`w-full flex items-center justify-between px-3 py-2 mb-1 rounded-xl text-left transition-colors ${
                    active
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Table2 className="w-4 h-4 shrink-0 text-slate-400" />
                    <span className="font-mono text-xs font-semibold truncate">{t.tableName}</span>
                  </span>
                  <span className="text-[10px] text-slate-400 shrink-0 tabular-nums">
                    {t.rowEstimate.toLocaleString()}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* Main pane. */}
      <main className="flex-1 min-w-0 p-4 overflow-x-hidden">
        {!selected ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400">
            <Database className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">Select a table to inspect its schema and data.</p>
          </div>
        ) : !schema ? (
          dataError ? (
            <ErrorBanner message={dataError} onRetry={() => selectTable(selected)} />
          ) : (
            <div className="space-y-3">
              <div className="h-12 bg-slate-100 rounded-2xl animate-pulse" />
              <div className="h-64 bg-slate-100 rounded-2xl animate-pulse" />
            </div>
          )
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-mono text-lg font-bold text-slate-800">{selected}</h2>
              <button
                type="button"
                onClick={loadRows}
                className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${rowsLoading ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>

            <SchemaPanel schema={schema} />

            <FilterBar
              schema={schema}
              applied={filters}
              onApply={applyFilters}
              onClear={clearFilters}
            />

            {dataError && (
              <ErrorBanner message={dataError} onRetry={loadRows} />
            )}

            {!dataError && total === 0 && !rowsLoading && filters.length > 0 ? (
              <div className="glass-card rounded-2xl p-8 text-center">
                <p className="text-sm text-slate-500 mb-3">No rows match the current filters.</p>
                <button
                  type="button"
                  onClick={clearFilters}
                  className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-xs font-bold hover:bg-slate-200"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <DataGrid
                schema={schema}
                rows={rows}
                total={total}
                page={page}
                pageSize={PAGE_SIZE}
                sort={sort}
                dir={dir}
                loading={rowsLoading}
                onSort={handleSort}
                onPage={setPage}
                onRowClick={setDrawerRow}
              />
            )}
          </div>
        )}
      </main>

      {schema && (
        <RowDetailDrawer
          schema={schema}
          row={drawerRow}
          onClose={() => setDrawerRow(null)}
          onFollowFk={followFk}
        />
      )}
    </div>
  );
};

const ErrorBanner: React.FC<{ message: string; onRetry: () => void }> = ({ message, onRetry }) => (
  <div className="glass-card rounded-2xl p-4 border-rose-200 bg-rose-50/60">
    <div className="flex items-start gap-2">
      <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0" />
      <div className="flex-1">
        <p className="text-sm font-semibold text-rose-700">Something went wrong</p>
        <p className="text-xs text-rose-600 mt-0.5 break-words">{message}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white text-rose-600 text-xs font-bold border border-rose-200 hover:bg-rose-50"
      >
        <RefreshCw className="w-3 h-3" /> Retry
      </button>
    </div>
  </div>
);

export default DataDashboard;
