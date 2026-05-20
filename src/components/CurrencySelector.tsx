import React from 'react';
import { useCurrency, EXCHANGE_RATES } from '../contexts/CurrencyContext';
import { DollarSign } from 'lucide-react';

export function CurrencySelector() {
  const { baseCurrency, setBaseCurrency } = useCurrency();

  return (
    <div className="flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200">
      <DollarSign className="w-4 h-4 text-slate-500" />
      <select
        value={baseCurrency}
        onChange={(e) => setBaseCurrency(e.target.value)}
        className="bg-transparent border-none text-sm font-medium text-slate-700 focus:ring-0 cursor-pointer outline-none"
      >
        {Object.keys(EXCHANGE_RATES).map((currency) => (
          <option key={currency} value={currency}>
            {currency}
          </option>
        ))}
      </select>
    </div>
  );
}
