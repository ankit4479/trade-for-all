export interface ExchangeRates {
  [key: string]: number;
}

export const SUPPORTED_CURRENCIES = [
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$' },
  { code: 'VND', name: 'Vietnamese Dong', symbol: '₫' },
];

export async function fetchExchangeRates(): Promise<ExchangeRates> {
  try {
    const response = await fetch('https://open.er-api.com/v6/latest/USD');
    const data = await response.json();
    return data.rates;
  } catch (error) {
    console.error('Failed to fetch exchange rates:', error);
    return { USD: 1 };
  }
}

export function convertPrice(priceStr: string, targetCurrency: string, rates: ExchangeRates): string {
  if (targetCurrency === 'USD' || !rates[targetCurrency]) return priceStr;

  // Regex to find numbers in the price string (e.g., "$2000 - $3000" or "1500 USD")
  const rate = rates[targetCurrency];
  const symbol = SUPPORTED_CURRENCIES.find(c => c.code === targetCurrency)?.symbol || targetCurrency;

  return priceStr.replace(/(\d+[\d,.]*)/g, (match) => {
    const num = parseFloat(match.replace(/,/g, ''));
    if (isNaN(num)) return match;
    
    const converted = num * rate;
    
    // Format the number based on the currency
    return new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 0,
    }).format(converted);
  }).replace('$', symbol).replace('USD', targetCurrency);
}
