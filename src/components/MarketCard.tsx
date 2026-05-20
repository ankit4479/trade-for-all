import React from 'react';
import { motion } from 'motion/react';
import { BookOpen, TrendingUp, AlertTriangle, ShieldCheck, MapPin, Info, Globe2, Zap, ShieldAlert, ArrowRight } from 'lucide-react';
import { Market, GreenMarket, YellowMarket, RedMarket } from '../types';

interface MarketCardProps {
  market: Market;
  type: 'green' | 'yellow' | 'red';
  index: number;
  onViewDetails: (market: Market) => void;
}

export const MarketCard: React.FC<MarketCardProps> = ({ market, type, index, onViewDetails }) => {
  const isGreen = type === 'green';
  const isYellow = type === 'yellow';
  const isRed = type === 'red';

  const greenMarket = market as GreenMarket;
  const yellowMarket = market as YellowMarket;
  const redMarket = market as RedMarket;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className={`group relative overflow-hidden bg-white p-6 rounded-3xl border transition-all duration-300 hover:shadow-xl ${
        isGreen ? 'border-emerald-100 hover:border-emerald-200' : 
        isYellow ? 'border-amber-100 hover:border-amber-200' : 
        'border-rose-100 hover:border-rose-200'
      }`}
    >
      {/* Background Accent */}
      <div className={`absolute -right-8 -top-8 w-32 h-32 rounded-full opacity-[0.03] transition-transform duration-500 group-hover:scale-150 ${
        isGreen ? 'bg-emerald-600' : isYellow ? 'bg-amber-600' : 'bg-rose-600'
      }`} />

      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-4">
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-sm transition-transform duration-300 group-hover:scale-110 ${
            isGreen ? 'bg-emerald-50 text-emerald-600' : 
            isYellow ? 'bg-amber-50 text-amber-600' : 
            'bg-rose-50 text-rose-600'
          }`}>
            <MapPin className="w-7 h-7" />
          </div>
          <div>
            <h3 className="text-2xl font-bold text-slate-900 tracking-tight">{market.country}</h3>
            <div className="flex items-center gap-2 mt-1">
              <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                isGreen ? 'bg-emerald-100 text-emerald-700' : 
                isYellow ? 'bg-amber-100 text-amber-700' : 
                'bg-rose-100 text-rose-700'
              }`}>
                {isGreen ? 'High Opportunity' : isYellow ? 'Moderate Potential' : 'High Risk'}
              </span>
              {isRed && redMarket.riskScore && (
                <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider">
                  Risk: {redMarket.riskScore}/10
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-5 relative z-10">
        {isGreen && (
          <>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                <TrendingUp className="w-4 h-4 text-emerald-500" />
                Market Dynamics
              </div>
              <p className="text-sm text-slate-600 leading-relaxed pl-6">{greenMarket.demand}</p>
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                Entry Barriers
              </div>
              <p className="text-sm text-slate-600 leading-relaxed pl-6">{greenMarket.barriers}</p>
            </div>

            {greenMarket.growthInsight && (
              <div className="bg-emerald-50/50 p-4 rounded-2xl border border-emerald-100/50">
                <div className="flex items-center gap-2 text-emerald-700 font-bold text-xs mb-1 uppercase tracking-wider">
                  <Zap className="w-3 h-3" /> Growth Insight
                </div>
                <p className="text-sm text-emerald-800 italic leading-relaxed">"{greenMarket.growthInsight}"</p>
              </div>
            )}

            {greenMarket.ftaDetails && (
              <div className="pt-4 border-t border-slate-100">
                <div className="flex items-center gap-2 text-slate-900 font-bold text-sm mb-2">
                  <Globe2 className="w-4 h-4 text-blue-500" />
                  Trade Agreement: {greenMarket.ftaDetails.name}
                </div>
                <div className="flex flex-wrap gap-2 pl-6">
                  {greenMarket.ftaDetails.benefits.map((benefit, i) => (
                    <span key={i} className="text-[10px] bg-blue-50 text-blue-700 px-2 py-1 rounded-lg font-medium border border-blue-100">
                      {benefit}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {isYellow && (
          <>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                <TrendingUp className="w-4 h-4 text-amber-500" />
                Potential Analysis
              </div>
              <p className="text-sm text-slate-600 leading-relaxed pl-6">{yellowMarket.potential}</p>
            </div>
            
            <div className="bg-amber-50/50 p-4 rounded-2xl border border-amber-100/50">
              <div className="flex items-center gap-2 text-amber-700 font-bold text-xs mb-1 uppercase tracking-wider">
                <Info className="w-3 h-3" /> Strategic Why
              </div>
              <p className="text-sm text-amber-800 italic leading-relaxed">"{yellowMarket.why}"</p>
            </div>
          </>
        )}

        {isRed && (
          <>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                <AlertTriangle className="w-4 h-4 text-rose-500" />
                Primary Barriers
              </div>
              <p className="text-sm text-slate-600 leading-relaxed pl-6">{redMarket.reason}</p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                <ShieldAlert className="w-4 h-4 text-rose-500" />
                Critical Caution
              </div>
              <p className="text-sm text-rose-700 font-medium italic leading-relaxed pl-6">"{redMarket.caution}"</p>
            </div>

            {redMarket.safestExecutionPlan && (
              <div className="pt-4 border-t border-slate-100">
                <div className="text-slate-900 font-bold text-sm mb-2">Safest Execution Strategy</div>
                <p className="text-xs text-slate-600 mb-3 pl-2 border-l-2 border-rose-200">{redMarket.safestExecutionPlan.partnershipStrategy}</p>
                <div className="flex flex-wrap gap-2">
                  {redMarket.safestExecutionPlan.riskMitigation.slice(0, 2).map((risk, i) => (
                    <span key={i} className="text-[10px] bg-rose-50 text-rose-700 px-2 py-1 rounded-lg font-medium border border-rose-100">
                      {risk}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <button 
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onViewDetails(market);
          }}
          className={`w-full mt-4 py-3 rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2 group/btn relative z-10 ${
            isGreen ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 
            isYellow ? 'bg-amber-50 text-amber-700 hover:bg-amber-100' : 
            'bg-rose-50 text-rose-700 hover:bg-rose-100'
          }`}
        >
          View Detailed Analysis
          <ArrowRight className="w-4 h-4 transition-transform group-hover/btn:translate-x-1" />
        </button>
      </div>
    </motion.div>
  );
};
