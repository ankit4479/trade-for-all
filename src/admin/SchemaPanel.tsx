/**
 * SchemaPanel — collapsible view of a table's column metadata.
 * ------------------------------------------------------------------
 * Renders every column straight from the server schema: name, data type, PK
 * badge(s) (composite PK → one badge per PK column), FK → target badge (self-FK
 * → same table), nullable, default, enum chips, and a `masked` badge. Purely
 * presentational — it owns only its own open/closed state.
 */
import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  KeyRound,
  Link2,
  EyeOff,
} from 'lucide-react';
import type { TableSchema, ColumnMeta } from './types';

interface SchemaPanelProps {
  schema: TableSchema;
}

const Badge: React.FC<{ className?: string; children: React.ReactNode }> = ({
  className = '',
  children,
}) => (
  <span
    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${className}`}
  >
    {children}
  </span>
);

const ColumnRow: React.FC<{ col: ColumnMeta }> = ({ col }) => (
  <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-slate-100 last:border-b-0 hover:bg-slate-50/60">
    <code className="font-mono text-xs font-semibold text-slate-800">{col.name}</code>
    <span className="font-mono text-[11px] text-slate-400">{col.dataType}</span>

    {col.isPk && (
      <Badge className="bg-amber-100 text-amber-700">
        <KeyRound className="w-3 h-3" /> PK
      </Badge>
    )}
    {col.isFk && (
      <Badge className="bg-blue-100 text-blue-700">
        <Link2 className="w-3 h-3" /> FK → {col.fkTable}.{col.fkColumn}
      </Badge>
    )}
    {col.masked && (
      <Badge className="bg-rose-100 text-rose-700">
        <EyeOff className="w-3 h-3" /> masked
      </Badge>
    )}
    {col.isNullable ? (
      <Badge className="bg-slate-100 text-slate-500">nullable</Badge>
    ) : (
      <Badge className="bg-slate-100 text-slate-500">not null</Badge>
    )}
    {col.columnDefault != null && (
      <span className="font-mono text-[10px] text-slate-400 truncate max-w-[180px]">
        default: {col.columnDefault}
      </span>
    )}

    {col.enumValues && col.enumValues.length > 0 && (
      <div className="flex flex-wrap gap-1 basis-full pl-1 pt-1">
        {col.enumValues.map((v) => (
          <span
            key={v}
            className="font-mono text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-100"
          >
            {v}
          </span>
        ))}
      </div>
    )}
  </div>
);

export const SchemaPanel: React.FC<SchemaPanelProps> = ({ schema }) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50/60 transition-colors"
      >
        <span className="flex items-center gap-2 font-bold text-sm text-slate-800">
          {open ? (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-400" />
          )}
          Schema
          <span className="font-normal text-xs text-slate-400">
            {schema.columns.length} columns
          </span>
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-100 max-h-72 overflow-y-auto custom-scrollbar">
          {schema.columns.map((col) => (
            <ColumnRow key={col.name} col={col} />
          ))}
        </div>
      )}
    </div>
  );
};

export default SchemaPanel;
