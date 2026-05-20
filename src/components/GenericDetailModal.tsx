import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Info, CheckCircle2, AlertCircle, Clock, DollarSign, Shield, MapPin, Globe } from 'lucide-react';

interface GenericDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  data: any;
}

export const GenericDetailModal: React.FC<GenericDetailModalProps> = ({ isOpen, onClose, title, subtitle, data }) => {
  if (!data) return null;

  const renderValue = (key: string, value: any) => {
    if (Array.isArray(value)) {
      return (
        <div className="flex flex-wrap gap-2 mt-2">
          {value.map((item, idx) => {
            if (typeof item === 'object' && item !== null) {
              // If it's a provider or similar object, try to show a name or stringify
              const label = item.name || item.requirement || item.licenseName || JSON.stringify(item);
              return (
                <div key={idx} className="w-full bg-slate-50 p-3 rounded-xl border border-slate-100 mb-2">
                  <pre className="text-[10px] text-slate-600 overflow-auto whitespace-pre-wrap">
                    {JSON.stringify(item, null, 2)}
                  </pre>
                </div>
              );
            }
            return (
              <span key={idx} className="px-3 py-1 bg-slate-100 text-slate-700 rounded-lg text-xs font-medium border border-slate-200">
                {String(item)}
              </span>
            );
          })}
        </div>
      );
    }
    if (typeof value === 'object' && value !== null) {
      return <pre className="text-xs bg-slate-50 p-3 rounded-xl mt-2 overflow-auto whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>;
    }
    return <p className="text-sm text-slate-600 mt-1 leading-relaxed">{String(value)}</p>;
  };

  const getIcon = (key: string) => {
    const k = key.toLowerCase();
    if (k.includes('cost') || k.includes('price')) return <DollarSign className="w-4 h-4 text-emerald-500" />;
    if (k.includes('time') || k.includes('period') || k.includes('duration')) return <Clock className="w-4 h-4 text-amber-500" />;
    if (k.includes('legal') || k.includes('basis') || k.includes('authority')) return <Shield className="w-4 h-4 text-blue-500" />;
    if (k.includes('risk')) return <AlertCircle className="w-4 h-4 text-rose-500" />;
    if (k.includes('step') || k.includes('process')) return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
    if (k.includes('port') || k.includes('where')) return <MapPin className="w-4 h-4 text-indigo-500" />;
    if (k.includes('network') || k.includes('global')) return <Globe className="w-4 h-4 text-blue-500" />;
    return <Info className="w-4 h-4 text-slate-400" />;
  };

  const formatKey = (key: string) => {
    return key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (str) => str.toUpperCase());
  };

  // Filter out keys that are already in the header or not useful for display
  const displayKeys = Object.keys(data).filter(k => 
    !['requirement', 'licenseName', 'name', 'mode', 'destination'].includes(k)
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          />
          
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
          >
            {/* Header */}
            <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{title}</h2>
                {subtitle && <p className="text-xs text-slate-500 font-medium mt-1 uppercase tracking-widest">{subtitle}</p>}
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-slate-600"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-8 space-y-8">
              {displayKeys.map((key) => (
                <div key={key} className="group">
                  <div className="flex items-center gap-2 mb-2">
                    {getIcon(key)}
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">{formatKey(key)}</h3>
                  </div>
                  <div className="pl-6">
                    {renderValue(key, data[key])}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="px-8 py-4 bg-slate-50 border-t border-slate-100 flex justify-end">
              <button 
                onClick={onClose}
                className="px-6 py-2 bg-slate-900 text-white rounded-xl font-bold text-sm hover:bg-slate-800 transition-colors"
              >
                Done
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
