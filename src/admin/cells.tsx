/**
 * Shared cell-value rendering for the grid and the row drawer.
 * ------------------------------------------------------------------
 * Centralises how a raw JSON value (from `/rows`) is classified and displayed so
 * DataGrid and RowDetailDrawer stay consistent: null vs empty string, booleans,
 * timestamps, uuids, jsonb/objects, masked columns, and long text truncation.
 */
import React, { useState } from 'react';
import { Check, X, Copy, ChevronDown, ChevronRight } from 'lucide-react';
import type { ColumnMeta } from './types';
import { MASKED_PLACEHOLDER } from './policy';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

/** Copy text to the clipboard, ignoring failures (e.g. insecure context). */
function copy(text: string): void {
  try {
    navigator.clipboard?.writeText(text);
  } catch {
    /* ignore */
  }
}

const CopyButton: React.FC<{ text: string }> = ({ text }) => (
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      copy(text);
    }}
    className="text-slate-300 hover:text-slate-600 transition-colors"
    aria-label="copy value"
  >
    <Copy className="w-3 h-3" />
  </button>
);

function formatTimestamp(value: string): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  // Stable, locale-independent-ish "YYYY-MM-DD HH:mm:ss".
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
}

/**
 * Compact, single-line cell for the grid. `masked` short-circuits everything.
 * `expandable` controls whether long text/jsonb gets an inline expand toggle
 * (the grid keeps cells short; the drawer renders full values).
 */
export const CellValue: React.FC<{
  value: unknown;
  col: ColumnMeta;
  expandable?: boolean;
}> = ({ value, col, expandable = true }) => {
  const [expanded, setExpanded] = useState(false);

  if (col.masked) {
    return <span className="font-mono text-rose-400">{MASKED_PLACEHOLDER}</span>;
  }

  if (value === null || value === undefined) {
    return <span className="text-slate-300 italic">null</span>;
  }

  if (typeof value === 'boolean') {
    return value ? (
      <Check className="w-4 h-4 text-emerald-500" />
    ) : (
      <X className="w-4 h-4 text-rose-400" />
    );
  }

  // Objects / arrays (jsonb) → compact JSON with optional expand.
  if (typeof value === 'object') {
    const json = JSON.stringify(value);
    if (expandable && json.length > 60) {
      return (
        <span className="inline-flex items-start gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((x) => !x);
            }}
            className="text-slate-400 hover:text-slate-600 mt-0.5"
          >
            {expanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </button>
          {expanded ? (
            <pre className="font-mono text-[11px] text-slate-600 whitespace-pre-wrap max-w-md">
              {JSON.stringify(value, null, 2)}
            </pre>
          ) : (
            <span className="font-mono text-[11px] text-slate-500 truncate max-w-xs">
              {json}
            </span>
          )}
        </span>
      );
    }
    return <span className="font-mono text-[11px] text-slate-500">{json}</span>;
  }

  const str = String(value);

  if (str === '') {
    return <span className="text-slate-300 italic">&quot;&quot;</span>;
  }

  // uuid → truncated + copy.
  if (typeof value === 'string' && UUID_RE.test(str)) {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-xs text-slate-600">
        {str.slice(0, 8)}…
        <CopyButton text={str} />
      </span>
    );
  }

  // timestamp-looking strings → formatted.
  if (typeof value === 'string' && ISO_RE.test(str)) {
    return <span className="font-mono text-xs text-slate-600">{formatTimestamp(str)}</span>;
  }

  // Long text → truncate + expand.
  if (expandable && str.length > 80) {
    return (
      <span className="inline-flex items-start gap-1">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((x) => !x);
          }}
          className="text-slate-400 hover:text-slate-600 mt-0.5"
        >
          {expanded ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
        </button>
        <span
          className={
            expanded
              ? 'text-xs text-slate-700 whitespace-pre-wrap max-w-md'
              : 'text-xs text-slate-700 truncate max-w-xs'
          }
        >
          {str}
        </span>
      </span>
    );
  }

  return <span className="text-xs text-slate-700">{str}</span>;
};

/** Helpers reused by the drawer for full (untruncated) rendering. */
export const cellHelpers = {
  isUuid: (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v),
  isTimestamp: (v: unknown): v is string => typeof v === 'string' && ISO_RE.test(v),
  formatTimestamp,
  copy,
};
