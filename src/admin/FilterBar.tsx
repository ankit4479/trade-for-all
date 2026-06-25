/**
 * FilterBar — auto-generated, schema-driven filter controls.
 * ------------------------------------------------------------------
 * For each non-masked column it renders the control chosen by
 * `controlForColumn()` (filterControls.ts). The user composes draft filters
 * locally; "Apply" lifts the assembled `Filter[]` to the dashboard which
 * re-queries the server (filtering is server-side). "Clear" resets to none.
 *
 * Enum multiselects pull their options from `col.enumValues` when present, else
 * lazily from `/distinct`. Nothing here is table-specific: a new column gets the
 * right control automatically.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Filter as FilterIcon, X, Plus, Search } from 'lucide-react';
import type { ColumnMeta, Filter, FilterOp, TableSchema } from './types';
import {
  controlForColumn,
  isFilterable,
  VALUELESS_OPS,
  OP_LABELS,
  type ColumnControl,
} from './filterControls';
import { getDistinct } from './api';

interface FilterBarProps {
  schema: TableSchema;
  /** Currently-applied filters (source of truth lives in the dashboard). */
  applied: Filter[];
  onApply: (filters: Filter[]) => void;
  onClear: () => void;
}

/* A draft filter being edited locally before Apply. */
interface DraftFilter {
  id: number;
  column: string;
  op: FilterOp;
  value?: unknown;
  value2?: unknown;
}

let nextId = 1;

/* ── per-control value editors ───────────────────────────────────────────── */

const inputCls =
  'px-2 py-1 rounded-lg border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300';

/** Enum multiselect — checkbox list backed by enumValues or /distinct. */
const MultiSelect: React.FC<{
  table: string;
  col: ColumnMeta;
  value: unknown[];
  onChange: (v: unknown[]) => void;
}> = ({ table, col, value, onChange }) => {
  const [options, setOptions] = useState<unknown[]>(col.enumValues ?? []);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (col.enumValues && col.enumValues.length) {
      setOptions(col.enumValues);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    getDistinct(table, col.name, 200, ctrl.signal)
      .then((r) => setOptions(r.values))
      .catch(() => {
        /* abort or error — leave options empty */
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [table, col.name, col.enumValues]);

  const selected = new Set(value.map((v) => String(v)));
  const toggle = (opt: unknown) => {
    const key = String(opt);
    if (selected.has(key)) {
      onChange(value.filter((v) => String(v) !== key));
    } else {
      onChange([...value, opt]);
    }
  };

  if (loading) return <span className="text-xs text-slate-400">loading…</span>;
  if (!options.length) return <span className="text-xs text-slate-400">no values</span>;

  return (
    <div className="flex flex-wrap gap-1 max-w-md">
      {options.map((opt) => {
        const on = selected.has(String(opt));
        return (
          <button
            key={String(opt)}
            type="button"
            onClick={() => toggle(opt)}
            className={`px-2 py-0.5 rounded-md text-[11px] font-medium border transition-colors ${
              on
                ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
            }`}
          >
            {String(opt)}
          </button>
        );
      })}
    </div>
  );
};

/* ── value editor dispatch by control kind ───────────────────────────────── */

const ValueEditor: React.FC<{
  table: string;
  col: ColumnMeta;
  control: ColumnControl;
  draft: DraftFilter;
  onChange: (patch: Partial<DraftFilter>) => void;
}> = ({ table, col, control, draft, onChange }) => {
  if (VALUELESS_OPS.has(draft.op)) return null;

  // Multiselect (enum) → `in`
  if (control.kind === 'multiselect' && draft.op === 'in') {
    const arr = Array.isArray(draft.value) ? (draft.value as unknown[]) : [];
    return (
      <MultiSelect table={table} col={col} value={arr} onChange={(v) => onChange({ value: v })} />
    );
  }

  // Range / number → between needs two inputs, otherwise one.
  if (control.kind === 'range') {
    if (draft.op === 'between') {
      return (
        <div className="flex items-center gap-1">
          <input
            type="number"
            className={inputCls + ' w-24'}
            placeholder="min"
            value={(draft.value as string) ?? ''}
            onChange={(e) => onChange({ value: e.target.value })}
          />
          <span className="text-slate-400 text-xs">–</span>
          <input
            type="number"
            className={inputCls + ' w-24'}
            placeholder="max"
            value={(draft.value2 as string) ?? ''}
            onChange={(e) => onChange({ value2: e.target.value })}
          />
        </div>
      );
    }
    return (
      <input
        type="number"
        className={inputCls + ' w-32'}
        placeholder="value"
        value={(draft.value as string) ?? ''}
        onChange={(e) => onChange({ value: e.target.value })}
      />
    );
  }

  // Date range → between (two datetime-local) else one.
  if (control.kind === 'daterange') {
    if (draft.op === 'between') {
      return (
        <div className="flex items-center gap-1">
          <input
            type="datetime-local"
            className={inputCls}
            value={(draft.value as string) ?? ''}
            onChange={(e) => onChange({ value: toIso(e.target.value) })}
          />
          <span className="text-slate-400 text-xs">–</span>
          <input
            type="datetime-local"
            className={inputCls}
            value={(draft.value2 as string) ?? ''}
            onChange={(e) => onChange({ value2: toIso(e.target.value) })}
          />
        </div>
      );
    }
    return (
      <input
        type="datetime-local"
        className={inputCls}
        value={(draft.value as string) ?? ''}
        onChange={(e) => onChange({ value: toIso(e.target.value) })}
      />
    );
  }

  // exact (uuid) / text / fallback → single text input.
  return (
    <input
      type="text"
      className={inputCls + ' w-56'}
      placeholder={control.kind === 'exact' ? 'exact value' : 'value'}
      value={(draft.value as string) ?? ''}
      onChange={(e) => onChange({ value: e.target.value })}
    />
  );
};

/** datetime-local gives a value without timezone — normalise to ISO string. */
function toIso(local: string): string {
  if (!local) return '';
  const d = new Date(local);
  return isNaN(d.getTime()) ? local : d.toISOString();
}

/* ── the bar ─────────────────────────────────────────────────────────────── */

export const FilterBar: React.FC<FilterBarProps> = ({ schema, applied, onApply, onClear }) => {
  const filterableCols = useMemo(
    () => schema.columns.filter(isFilterable),
    [schema],
  );

  // Seed drafts from applied filters whenever the applied set or table changes.
  const [drafts, setDrafts] = useState<DraftFilter[]>([]);
  useEffect(() => {
    setDrafts(
      applied.map((f) => ({
        id: nextId++,
        column: f.column,
        op: f.op,
        value: f.value,
        value2: f.value2,
      })),
    );
  }, [applied, schema.table]);

  const colByName = useMemo(() => {
    const m = new Map<string, ColumnMeta>();
    for (const c of filterableCols) m.set(c.name, c);
    return m;
  }, [filterableCols]);

  const addDraft = () => {
    const first = filterableCols[0];
    if (!first) return;
    const control = controlForColumn(first);
    if (!control) return;
    setDrafts((d) => [
      ...d,
      { id: nextId++, column: first.name, op: control.ops[0] },
    ]);
  };

  const updateDraft = (id: number, patch: Partial<DraftFilter>) => {
    setDrafts((d) => d.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  const removeDraft = (id: number) => {
    setDrafts((d) => d.filter((f) => f.id !== id));
  };

  /** When the column changes, reset op to the new column's first op. */
  const changeColumn = (id: number, column: string) => {
    const col = colByName.get(column);
    const control = col ? controlForColumn(col) : null;
    updateDraft(id, {
      column,
      op: control?.ops[0] ?? 'eq',
      value: undefined,
      value2: undefined,
    });
  };

  const apply = () => {
    const out: Filter[] = [];
    for (const d of drafts) {
      const col = colByName.get(d.column);
      if (!col) continue;
      if (VALUELESS_OPS.has(d.op)) {
        out.push({ column: d.column, op: d.op });
        continue;
      }
      if (d.op === 'in') {
        const arr = Array.isArray(d.value) ? (d.value as unknown[]) : [];
        if (arr.length) out.push({ column: d.column, op: 'in', value: arr });
        continue;
      }
      if (d.op === 'between') {
        // Server skips a half-filled between; only send when both bounds exist.
        if (d.value != null && d.value !== '' && d.value2 != null && d.value2 !== '') {
          out.push({ column: d.column, op: 'between', value: d.value, value2: d.value2 });
        }
        continue;
      }
      if (d.value != null && d.value !== '') {
        out.push({ column: d.column, op: d.op, value: d.value });
      }
    }
    onApply(out);
  };

  const clear = () => {
    setDrafts([]);
    onClear();
  };

  return (
    <div className="glass-card rounded-2xl p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="flex items-center gap-2 font-bold text-sm text-slate-800">
          <FilterIcon className="w-4 h-4 text-slate-400" /> Filters
          {applied.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-emerald-100 text-emerald-700">
              {applied.length} active
            </span>
          )}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={addDraft}
            className="flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900"
          >
            <Plus className="w-3.5 h-3.5" /> Add filter
          </button>
        </div>
      </div>

      {drafts.length === 0 ? (
        <p className="text-xs text-slate-400 py-1">No filters. Add one to narrow results.</p>
      ) : (
        <div className="space-y-2">
          {drafts.map((d) => {
            const col = colByName.get(d.column);
            const control = col ? controlForColumn(col) : null;
            return (
              <div key={d.id} className="flex flex-wrap items-center gap-2">
                <select
                  className={inputCls}
                  value={d.column}
                  onChange={(e) => changeColumn(d.id, e.target.value)}
                >
                  {filterableCols.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>

                <select
                  className={inputCls}
                  value={d.op}
                  onChange={(e) => updateDraft(d.id, { op: e.target.value as FilterOp })}
                >
                  {(control?.ops ?? []).map((op) => (
                    <option key={op} value={op}>
                      {OP_LABELS[op]}
                    </option>
                  ))}
                </select>

                {col && control && (
                  <ValueEditor
                    table={schema.table}
                    col={col}
                    control={control}
                    draft={d}
                    onChange={(patch) => updateDraft(d.id, patch)}
                  />
                )}

                <button
                  type="button"
                  onClick={() => removeDraft(d.id)}
                  className="text-slate-400 hover:text-rose-500"
                  aria-label="remove filter"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100">
        <button
          type="button"
          onClick={apply}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition-colors"
        >
          <Search className="w-3.5 h-3.5" /> Apply
        </button>
        <button
          type="button"
          onClick={clear}
          className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-xs font-bold hover:bg-slate-200 transition-colors"
        >
          Clear filters
        </button>
      </div>
    </div>
  );
};

export default FilterBar;
