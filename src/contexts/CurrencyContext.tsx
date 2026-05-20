import React, { createContext, useContext, useState, ReactNode } from 'react';

export const EXCHANGE_RATES: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  INR: 83.12,
  JPY: 151.50,
  CNY: 7.23,
  AUD: 1.53,
  CAD: 1.36,
};

export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  INR: '₹',
  JPY: '¥',
  CNY: '¥',
  AUD: 'A$',
  CAD: 'C$',
};

interface CurrencyContextType {
  baseCurrency: string;
  setBaseCurrency: (currency: string) => void;
  convertText: (text: string | number | undefined) => string;
  convertValue: (value: number, fromCurrency?: string) => number;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [baseCurrency, setBaseCurrency] = useState('USD');

  const convertValue = (value: number, fromCurrency = 'USD') => {
    const valueInUSD = value / (EXCHANGE_RATES[fromCurrency] || 1);
    return valueInUSD * EXCHANGE_RATES[baseCurrency];
  };

  const convertText = (text: string | number | undefined): string => {
    if (text === undefined || text === null) return '';
    const strText = String(text);
    
    const regex = /([$€£₹¥]|USD|EUR|GBP|INR|JPY|CNY|AUD|CAD)\s*([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s*([$€£₹¥]|USD|EUR|GBP|INR|JPY|CNY|AUD|CAD)/gi;

    return strText.replace(regex, (match, sym1, num1, num2, sym2) => {
      const symbol = (sym1 || sym2).toUpperCase();
      const numStr = num1 || num2;
      
      let sourceCurrency = 'USD';
      if (symbol === '€' || symbol === 'EUR') sourceCurrency = 'EUR';
      else if (symbol === '£' || symbol === 'GBP') sourceCurrency = 'GBP';
      else if (symbol === '₹' || symbol === 'INR') sourceCurrency = 'INR';
      else if (symbol === '¥' || symbol === 'JPY') sourceCurrency = 'JPY';
      else if (symbol === 'CNY') sourceCurrency = 'CNY';
      else if (symbol === 'A$' || symbol === 'AUD') sourceCurrency = 'AUD';
      else if (symbol === 'C$' || symbol === 'CAD') sourceCurrency = 'CAD';
      
      const value = parseFloat(numStr.replace(/,/g, ''));
      if (isNaN(value)) return match;
      
      const convertedValue = convertValue(value, sourceCurrency);
      const targetSymbol = CURRENCY_SYMBOLS[baseCurrency];
      
      const formattedValue = new Intl.NumberFormat('en-US', {
        maximumFractionDigits: convertedValue % 1 === 0 ? 0 : 2,
      }).format(convertedValue);
      
      return `${targetSymbol}${formattedValue}`;
    });
  };

  return (
    <CurrencyContext.Provider value={{ baseCurrency, setBaseCurrency, convertText, convertValue }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const context = useContext(CurrencyContext);
  if (context === undefined) {
    throw new Error('useCurrency must be used within a CurrencyProvider');
  }
  return context;
}
