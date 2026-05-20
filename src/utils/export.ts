import { MarketAnalysis } from '../types';

export const exportToCSV = (result: MarketAnalysis) => {
  const headers = ['Market Type', 'Country', 'HS Code', 'Why/Reason', 'Market Insight', 'Duty Rate', 'Tax Rate', 'Logistics Cost', 'Currency'];
  
  const rows: string[][] = [];

  // Green Markets
  result.greenMarkets.forEach(m => {
    rows.push([
      'Green',
      m.country,
      result.hsCode,
      m.why || '',
      m.marketInsight || '',
      m.simulationParams?.dutyRate?.toString() || '0',
      m.simulationParams?.taxRate?.toString() || '0',
      m.simulationParams?.logisticsCostPerUnit?.toString() || '0',
      m.simulationParams?.currency || 'USD'
    ]);
  });

  // Yellow Markets
  result.yellowMarkets.forEach(m => {
    rows.push([
      'Yellow',
      m.country,
      result.hsCode,
      m.why || '',
      m.marketInsight || '',
      m.simulationParams?.dutyRate?.toString() || '0',
      m.simulationParams?.taxRate?.toString() || '0',
      m.simulationParams?.logisticsCostPerUnit?.toString() || '0',
      m.simulationParams?.currency || 'USD'
    ]);
  });

  // Red Markets
  result.redMarkets.forEach(m => {
    rows.push([
      'Red',
      m.country,
      result.hsCode,
      m.reason || '',
      m.marketInsight || '',
      m.simulationParams?.dutyRate?.toString() || '0',
      m.simulationParams?.taxRate?.toString() || '0',
      m.simulationParams?.logisticsCostPerUnit?.toString() || '0',
      m.simulationParams?.currency || 'USD'
    ]);
  });

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `trade_analysis_${result.productName.toLowerCase().replace(/\s+/g, '_')}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
