/**
 * DataGrid — dynamic, sortable, paginated table view.
 * ------------------------------------------------------------------
 * Columns are derived from the server schema (never hardcoded). Header clicks
 * toggle server-side sort (asc → desc → asc). Cells render via the shared
 * CellValue helper. Wide tables scroll horizontally; a row click opens the
 * drawer. Pagination is server-side; controls disable at the boundaries.
 */
import React from 'react';
import {
  ChevronUp,
  ChevronDown,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  KeyRound,
} from 'lucide-react';
import type { TableSchema } from './types';
import { CellValue } from './cells';

interface DataGridProps {
  schema: TableSchema;
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
  sort: string | null;
  dir: 'asc' | 'desc';
  loading: boolean;
  onSort: (column: string) => void;
  onPage: (page: number) => void;
  onRowClick: (row: Record<string, unknown>) => void;
}

export const DataGrid: React.FC<DataGridProps> = ({
  schema,
  rows,
  total,
  page,
  pageSize,
  sort,
  dir,
  loading,
  onSort,
  onPage,
  onRowClick,
}) => {
  const cols = schema.columns;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="glass-card rounded-2xl overflow-hidden flex flex-col">
      {/* Scroll container — horizontal for wide tables. */}
      <div className="overflow-x-auto custom-scrollbar">
        <table className="min-w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/60">
              {cols.map((col) => {
                const active = sort === col.name;
                return (
                  <th
                    key={col.name}
                    onClick={() => onSort(col.name)}
                    className="px-3 py-2 whitespace-nowrap cursor-pointer select-none hover:bg-slate-100 transition-colors"
                  >
                    <span className="inline-flex items-center gap-1 font-bold text-[11px] uppercase tracking-wider text-slate-500">
                      {col.isPk && <KeyRound className="w-3 h-3 text-amber-500" />}
                      {col.name}
                      {active &&
                        (dir === 'asc' ? (
                          <ChevronUp className="w-3 h-3 text-emerald-600" />
                        ) : (
                          <ChevronDown className="w-3 h-3 text-emerald-600" />
                        ))}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              // Skeleton rows.
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-slate-100">
                  {cols.map((c) => (
                    <td key={c.name} className="px-3 py-2.5">
                      <div className="h-3 w-20 bg-slate-100 rounded animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={cols.length} className="px-3 py-10 text-center text-sm text-slate-400">
                  No rows match.
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr
                  key={i}
                  onClick={() => onRowClick(row)}
                  className="border-b border-slate-100 hover:bg-emerald-50/40 cursor-pointer transition-colors"
                >
                  {cols.map((col) => (
                    <td key={col.name} className="px-3 py-2.5 whitespace-nowrap align-top">
                      <CellValue value={row[col.name]} col={col} />
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination footer. */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-slate-100 bg-slate-50/40">
        <span className="text-xs text-slate-500">
          {total === 0 ? 'No rows' : `Showing ${from}–${to} of ${total.toLocaleString()}`}
        </span>
        <div className="flex items-center gap-1">
          <PageBtn disabled={page <= 1} onClick={() => onPage(1)} label="First page">
            <ChevronsLeft className="w-4 h-4" />
          </PageBtn>
          <PageBtn disabled={page <= 1} onClick={() => onPage(page - 1)} label="Previous page">
            <ChevronLeft className="w-4 h-4" />
          </PageBtn>
          <span className="px-2 text-xs font-semibold text-slate-600">
            Page {page} / {lastPage}
          </span>
          <PageBtn
            disabled={page >= lastPage}
            onClick={() => onPage(page + 1)}
            label="Next page"
          >
            <ChevronRight className="w-4 h-4" />
          </PageBtn>
          <PageBtn
            disabled={page >= lastPage}
            onClick={() => onPage(lastPage)}
            label="Last page"
          >
            <ChevronsRight className="w-4 h-4" />
          </PageBtn>
        </div>
      </div>
    </div>
  );
};

const PageBtn: React.FC<{
  disabled: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}> = ({ disabled, onClick, label, children }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    aria-label={label}
    className="p-1 rounded-lg text-slate-500 hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
  >
    {children}
  </button>
);

export default DataGrid;
