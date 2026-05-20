import React, { useState } from 'react';
import { Calculator, ArrowRight, DollarSign, Package, FileText } from 'lucide-react';
import { SimulationParams } from '../types';

interface ExportSimulatorProps {
  country: string;
  params: SimulationParams;
}

export const ExportSimulator: React.FC<ExportSimulatorProps> = ({ country, params }) => {
  const [units, setUnits] = useState<number>(1000);
  const [unitPrice, setUnitPrice] = useState<number>(10);

  const subtotal = units * unitPrice;
  const dutyCost = subtotal * (params.dutyRate / 100);
  const taxCost = (subtotal + dutyCost) * (params.taxRate / 100);
  const logisticsCost = units * params.logisticsCostPerUnit;
  const totalLandedCost = subtotal + dutyCost + taxCost + logisticsCost;
  const landedCostPerUnit = totalLandedCost / units;

  return (
    <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm mt-4">
      <div className="flex items-center gap-2 mb-6">
        <Calculator className="w-5 h-5 text-indigo-600" />
        <h4 className="font-bold text-slate-900">Export Cost Simulator: {country}</h4>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
            Number of Units ({params.unitName}s)
          </label>
          <input
            type="number"
            value={units}
            onChange={(e) => setUnits(Math.max(1, parseInt(e.target.value) || 0))}
            className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-0"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
            Price per Unit ({params.currency})
          </label>
          <input
            type="number"
            value={unitPrice}
            onChange={(e) => setUnitPrice(Math.max(0.01, parseFloat(e.target.value) || 0))}
            className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-0"
          />
        </div>
      </div>

      <div className="bg-slate-50 rounded-xl p-6 space-y-4">
        <div className="flex justify-between items-center text-sm">
          <span className="text-slate-600 flex items-center gap-2"><Package className="w-4 h-4" /> Goods Value</span>
          <span className="font-medium text-slate-900">{params.currency} {subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
        <div className="flex justify-between items-center text-sm">
          <span className="text-slate-600 flex items-center gap-2"><FileText className="w-4 h-4" /> Import Duties ({params.dutyRate}%)</span>
          <span className="font-medium text-rose-600">+{params.currency} {dutyCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
        <div className="flex justify-between items-center text-sm">
          <span className="text-slate-600 flex items-center gap-2"><DollarSign className="w-4 h-4" /> Taxes/VAT ({params.taxRate}%)</span>
          <span className="font-medium text-rose-600">+{params.currency} {taxCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
        <div className="flex justify-between items-center text-sm">
          <span className="text-slate-600 flex items-center gap-2"><ArrowRight className="w-4 h-4" /> Est. Logistics</span>
          <span className="font-medium text-amber-600">+{params.currency} {logisticsCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
        
        <div className="pt-4 border-t border-slate-200">
          <div className="flex justify-between items-end">
            <div>
              <span className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Total Landed Cost</span>
              <span className="text-2xl font-bold text-indigo-600">{params.currency} {totalLandedCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="text-right">
              <span className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Cost Per Unit</span>
              <span className="text-lg font-bold text-slate-900">{params.currency} {landedCostPerUnit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
