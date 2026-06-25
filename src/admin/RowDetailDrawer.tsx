/**
 * RowDetailDrawer — full detail for one row, with FK click-through.
 * ------------------------------------------------------------------
 * Slides in from the right. Shows every column at full fidelity: pretty-printed
 * jsonb, full uuid + copy, formatted timestamps, masked → •••. FK columns with a
 * non-null value render as a link that navigates to the referenced table,
 * pre-filtered by `fkColumn = value`, and opens that row's drawer (self-FK
 * drill-through works the same way). Null FK values are not clickable.
 */
import React from 'react';
import { X, Copy, KeyRound, Link2, ExternalLink } from 'lucide-react';
import type { TableSchema, ColumnMeta } from './types';
import { MASKED_PLACEHOLDER } from './policy';
import { cellHelpers } from './cells';

interface RowDetailDrawerProps {
  schema: TableSchema;
  row: Record<string, unknown> | null;
  onClose: () => void;
  /** Navigate to another table filtered by a single column = value (FK click). */
  onFollowFk: (table: string, column: string, value: unknown) => void;
}

const Field: React.FC<{ col: ColumnMeta; value: unknown; onFollowFk: RowDetailDrawerProps['onFollowFk'] }> = ({
  col,
  value,
  onFollowFk,
}) => {
  return (
    <div className="py-2 border-b border-slate-100 last:border-b-0">
      <div className="flex items-center gap-2 mb-1">
        <code className="font-mono text-[11px] font-semibold text-slate-700">{col.name}</code>
        <span className="font-mono text-[10px] text-slate-400">{col.dataType}</span>
        {col.isPk && <KeyRound className="w-3 h-3 text-amber-500" />}
        {col.isFk && <Link2 className="w-3 h-3 text-blue-500" />}
      </div>
      <div className="pl-1 text-sm">
        <FieldValue col={col} value={value} onFollowFk={onFollowFk} />
      </div>
    </div>
  );
};

const FieldValue: React.FC<{
  col: ColumnMeta;
  value: unknown;
  onFollowFk: RowDetailDrawerProps['onFollowFk'];
}> = ({ col, value, onFollowFk }) => {
  if (col.masked) {
    return <span className="font-mono text-rose-400">{MASKED_PLACEHOLDER}</span>;
  }

  if (value === null || value === undefined) {
    return <span className="text-slate-300 italic">null</span>;
  }

  // FK with a value → clickable link to the referenced row.
  if (col.isFk && col.fkTable && col.fkColumn) {
    return (
      <button
        type="button"
        onClick={() => onFollowFk(col.fkTable!, col.fkColumn!, value)}
        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline font-medium"
      >
        {renderScalar(value)}
        <ExternalLink className="w-3 h-3" />
        <span className="text-[10px] text-slate-400">
          → {col.fkTable}.{col.fkColumn}
        </span>
      </button>
    );
  }

  if (typeof value === 'boolean') {
    return <span className="font-mono text-slate-700">{value ? 'true' : 'false'}</span>;
  }

  // jsonb / objects → pretty-printed.
  if (typeof value === 'object') {
    return (
      <pre className="font-mono text-[11px] text-slate-600 bg-slate-50 rounded-lg p-2 whitespace-pre-wrap overflow-x-auto custom-scrollbar">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }

  const str = String(value);
  if (str === '') return <span className="text-slate-300 italic">&quot;&quot; (empty)</span>;

  // Full uuid + copy.
  if (cellHelpers.isUuid(value)) {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-xs text-slate-700 break-all">
        {str}
        <button
          type="button"
          onClick={() => cellHelpers.copy(str)}
          className="text-slate-300 hover:text-slate-600"
          aria-label="copy uuid"
        >
          <Copy className="w-3 h-3" />
        </button>
      </span>
    );
  }

  if (cellHelpers.isTimestamp(value)) {
    return (
      <span className="font-mono text-xs text-slate-700">{cellHelpers.formatTimestamp(str)}</span>
    );
  }

  return <span className="text-slate-700 whitespace-pre-wrap break-words">{str}</span>;
};

/** Compact scalar for the FK link label (uuid truncated, else as-is). */
function renderScalar(value: unknown): string {
  const str = String(value);
  if (cellHelpers.isUuid(value)) return str.slice(0, 8) + '…';
  return str;
}

export const RowDetailDrawer: React.FC<RowDetailDrawerProps> = ({
  schema,
  row,
  onClose,
  onFollowFk,
}) => {
  if (!row) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop. */}
      <div className="absolute inset-0 bg-slate-900/20 backdrop-blur-[2px]" onClick={onClose} />

      {/* Panel. */}
      <div className="relative w-full max-w-lg h-full bg-white shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div>
            <h3 className="font-bold text-slate-800">Row detail</h3>
            <p className="text-xs text-slate-400 font-mono">{schema.table}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-2">
          {schema.columns.map((col) => (
            <Field key={col.name} col={col} value={row[col.name]} onFollowFk={onFollowFk} />
          ))}
        </div>
      </div>
    </div>
  );
};

export default RowDetailDrawer;
