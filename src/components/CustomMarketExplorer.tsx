import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Search, Globe, ArrowRight, Loader2, AlertCircle } from 'lucide-react';

interface CustomMarketExplorerProps {
  onSelectCountry: (country: string) => void;
  isAnalyzing: boolean;
}

const COUNTRIES = [
  "United States", "China", "Germany", "United Kingdom", "Japan", "India", "France", "Canada", "Italy", "Brazil",
  "Australia", "South Korea", "Russia", "Mexico", "Spain", "Indonesia", "Netherlands", "Saudi Arabia", "Turkey", "Switzerland",
  "United Arab Emirates", "Singapore", "Vietnam", "Thailand", "Malaysia", "Poland", "Sweden", "Belgium", "Norway", "Austria",
  "Denmark", "Finland", "Ireland", "Portugal", "Greece", "Israel", "South Africa", "Egypt", "Nigeria", "Kenya",
  "Argentina", "Chile", "Colombia", "Peru", "New Zealand", "Philippines", "Bangladesh", "Pakistan", "Iran", "Iraq",
  "Czech Republic", "Hungary", "Romania", "Ukraine", "Kazakhstan", "Algeria", "Morocco", "Ethiopia", "Ghana", "Tanzania",
  "Uzbekistan", "Sri Lanka", "Myanmar", "Cambodia", "Laos", "Jordan", "Lebanon", "Oman", "Kuwait", "Qatar",
  "Singapore", "Hong Kong", "Taiwan", "South Korea", "Israel", "Norway", "Luxembourg", "Iceland", "Malta", "Cyprus",
  "Estonia", "Latvia", "Lithuania", "Slovenia", "Slovakia", "Croatia", "Bulgaria", "Serbia", "Georgia", "Armenia",
  "Azerbaijan", "Tunisia", "Senegal", "Ivory Coast", "Mauritius", "Costa Rica", "Panama", "Uruguay", "Paraguay", "Ecuador"
].sort();

const UNIQUE_COUNTRIES = Array.from(new Set(COUNTRIES));

export const CustomMarketExplorer: React.FC<CustomMarketExplorerProps> = ({ onSelectCountry, isAnalyzing }) => {
  const [search, setSearch] = useState('');
  const [selectedCountry, setSelectedCountry] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const filteredCountries = UNIQUE_COUNTRIES.filter(c => 
    c.toLowerCase().includes(search.toLowerCase())
  );

  const handleAnalyze = () => {
    const finalCountry = selectedCountry || search;
    if (finalCountry.trim()) {
      onSelectCountry(finalCountry.trim());
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
            <Globe className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">Custom Market Explorer</h3>
            <p className="text-sm text-slate-500">Select any country for a deep-dive trade analysis</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="relative">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type="text"
                placeholder="Search or type a country..."
                value={selectedCountry || search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setSelectedCountry('');
                  setIsDropdownOpen(true);
                }}
                onFocus={() => setIsDropdownOpen(true)}
                onBlur={() => {
                  // Small delay to allow clicking the dropdown
                  setTimeout(() => setIsDropdownOpen(false), 200);
                }}
                className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all font-medium"
              />
            </div>

            {isDropdownOpen && filteredCountries.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute z-10 w-full mt-2 bg-white border border-slate-100 rounded-2xl shadow-xl max-h-60 overflow-y-auto"
              >
                {filteredCountries.map((country) => (
                  <button
                    key={country}
                    onClick={() => {
                      setSelectedCountry(country);
                      setSearch('');
                      setIsDropdownOpen(false);
                    }}
                    className="w-full px-6 py-3 text-left text-sm text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-colors flex items-center justify-between group"
                  >
                    {country}
                    <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all" />
                  </button>
                ))}
              </motion.div>
            )}
          </div>

          <button
            onClick={handleAnalyze}
            disabled={(!selectedCountry && !search.trim()) || isAnalyzing}
            className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-100"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Generating Report...
              </>
            ) : (
              <>
                Generate Detailed Report
                <ArrowRight className="w-5 h-5" />
              </>
            )}
          </button>

          {(selectedCountry || search.trim()) && !isAnalyzing && (
            <div className="flex items-center gap-2 p-3 bg-emerald-50 rounded-xl border border-emerald-100">
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              <p className="text-xs text-emerald-700 font-medium">Ready to analyze trade routes for {selectedCountry || search}</p>
            </div>
          )}
        </div>
      </div>

      <div className="px-8 py-4 bg-slate-50 border-t border-slate-100">
        <div className="flex items-start gap-3">
          <Info className="w-4 h-4 text-slate-400 mt-0.5" />
          <p className="text-[10px] text-slate-500 leading-relaxed uppercase font-bold tracking-wider">
            This report includes trade laws, taxes, duties, customs rules, and a step-by-step execution roadmap.
          </p>
        </div>
      </div>
    </div>
  );
};

// Helper components for icons not imported
const ShieldCheck = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
  </svg>
);

const Info = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);
