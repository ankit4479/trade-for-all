import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { feature } from 'topojson-client';
import { motion, AnimatePresence } from 'motion/react';
import { X, TrendingUp, AlertTriangle, ShieldCheck, Info, Globe, BookOpen, FileText, AlertCircle, Loader2, Plane, Ship, Truck, Train } from 'lucide-react';
import { GreenMarket, YellowMarket, RedMarket } from '../types';
import { ExportSimulator } from './ExportSimulator';

interface WorldMapProps {
  greenMarkets: GreenMarket[];
  yellowMarkets: YellowMarket[];
  redMarkets: RedMarket[];
  originCountry: string;
  onSelectCountry?: (market: any, type: 'green' | 'yellow' | 'red' | 'origin' | 'neutral', isFullAnalysis?: boolean) => void;
  isAnalyzing?: boolean;
  activeDestination?: string;
}

const WorldMap: React.FC<WorldMapProps> = ({ greenMarkets, yellowMarkets, redMarkets, originCountry, onSelectCountry, isAnalyzing, activeDestination }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredCountry, setHoveredCountry] = useState<{ name: string; type: 'green' | 'red' | 'yellow' | 'origin' | 'neutral'; details: any } | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<{ name: string; type: 'green' | 'red' | 'yellow' | 'origin' | 'neutral'; details: any } | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [mapData, setMapData] = useState<any>(null);
  const [mapError, setMapError] = useState<boolean>(false);
  const [selectedMode, setSelectedMode] = useState<'air' | 'sea' | 'land'>('air');

  useEffect(() => {
    d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
      .then(setMapData)
      .catch(err => {
        console.error('Failed to load map data:', err);
        setMapError(true);
      });
  }, []);

  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const width = containerRef.current.offsetWidth;
        if (width > 0) setDimensions({ width, height: width * 0.5 });
      }
    };
    updateDimensions();
    const timer = setTimeout(updateDimensions, 100);
    window.addEventListener('resize', updateDimensions);
    return () => { window.removeEventListener('resize', updateDimensions); clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!dimensions.width || !dimensions.height || !mapData || !svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const projection = d3.geoEqualEarth().scale(dimensions.width / 5.5).translate([dimensions.width / 2, dimensions.height / 2]);
    const path = d3.geoPath().projection(projection);
    const g = svg.append('g');

    const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([1, 8]).on('zoom', (event) => { g.attr('transform', event.transform); });
    svg.call(zoom);

    const countries = feature(mapData, mapData.objects.countries) as any;

    const normalizeCountryName = (name: string) => {
      const mapping: { [key: string]: string } = {
        'united states': 'united states of america', 'usa': 'united states of america', 'uk': 'united kingdom', 'uae': 'united arab emirates',
        'south korea': 'korea, republic of', 'vietnam': 'viet nam', 'russia': 'russian federation', 'tanzania': 'united republic of tanzania',
        'congo': 'democratic republic of the congo', 'dr congo': 'democratic republic of the congo', 'iran': 'iran (islamic republic of)',
        'syria': 'syrian arab republic', 'venezuela': 'venezuela (bolivarian republic of)', 'bolivia': 'bolivia (plurinational state of)',
        'laos': "lao people's democratic republic", 'brunei': 'brunei darussalam', 'moldova': 'republic of moldova', 'czech republic': 'czechia',
        'ivory coast': "côte d'ivoire", 'south sudan': 's. sudan', 'central african republic': 'central african rep.', 'dominican republic': 'dominican rep.',
        'falkland islands': 'falkland is.', 'solomon islands': 'solomon is.', 'equatorial guinea': 'eq. guinea',
      };
      const lower = name.toLowerCase().trim();
      return mapping[lower] || lower;
    };

    const greenMap = new Map<string, GreenMarket>(greenMarkets.map(m => [normalizeCountryName(m.country), m]));
    const yellowMap = new Map<string, YellowMarket>(yellowMarkets.map(m => [normalizeCountryName(m.country), m]));
    const redMap = new Map<string, RedMarket>(redMarkets.map(m => [normalizeCountryName(m.country), m]));
    const normalizedOrigin = normalizeCountryName(originCountry);

    // Fallback logic to ensure no country is grey
    countries.features.forEach((feature: any) => {
      const name = feature.properties.name;
      const normalizedName = normalizeCountryName(name);
      if (normalizedName !== normalizedOrigin && !greenMap.has(normalizedName) && !yellowMap.has(normalizedName) && !redMap.has(normalizedName)) {
        redMap.set(normalizedName, {
          country: name,
          reason: 'Unverified market. Assumed high barrier or low viability.',
          taxOrBarrier: 'Unknown',
          caution: 'Proceed with caution. Comprehensive data not available.'
        } as RedMarket);
      }
    });

    g.selectAll('path')
      .data(countries.features)
      .enter()
      .append('path')
      .attr('d', path)
      .attr('class', 'country')
      .attr('fill', (d: any) => {
        const name = normalizeCountryName(d.properties.name);
        if (name === normalizedOrigin) return '#6366f1';
        if (greenMap.has(name)) return '#10b981';
        if (yellowMap.has(name)) return '#f59e0b';
        if (redMap.has(name)) return '#f43f5e';
        return '#f43f5e'; // Fallback just in case
      })
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 0.5)
      .style('cursor', 'pointer')
      .on('mouseover', (event, d: any) => {
        const name = d.properties.name;
        const normalizedName = normalizeCountryName(name);
        let type: 'green' | 'red' | 'yellow' | 'origin' | 'neutral' = 'neutral';
        let details: any = null;

        if (normalizedName === normalizedOrigin) { type = 'origin'; details = { why: 'This is your origin country.' }; }
        else if (greenMap.has(normalizedName)) { type = 'green'; details = greenMap.get(normalizedName); }
        else if (yellowMap.has(normalizedName)) { type = 'yellow'; details = yellowMap.get(normalizedName); }
        else if (redMap.has(normalizedName)) { type = 'red'; details = redMap.get(normalizedName); }

        d3.select(event.currentTarget).transition().duration(200).attr('fill-opacity', 0.8).attr('stroke', '#000000').attr('stroke-width', 1);
        setHoveredCountry({ name, type, details });
      })
      .on('mouseout', (event, d: any) => {
        d3.select(event.currentTarget).transition().duration(200).attr('fill-opacity', 1).attr('stroke', '#ffffff').attr('stroke-width', 0.5);
        setHoveredCountry(null);
      })
      .on('click', (event, d: any) => {
        const name = d.properties.name;
        const normalizedName = normalizeCountryName(name);
        let selection: any = null;
        if (normalizedName === normalizedOrigin) {
          selection = { name, type: 'origin', details: { why: 'This is your origin country.' } };
        } else if (greenMap.has(normalizedName)) {
          selection = { name, type: 'green', details: greenMap.get(normalizedName) };
        } else if (yellowMap.has(normalizedName)) {
          selection = { name, type: 'yellow', details: yellowMap.get(normalizedName) };
        } else if (redMap.has(normalizedName)) {
          selection = { name, type: 'red', details: redMap.get(normalizedName) };
        }

        if (selection) {
          setSelectedCountry(selection);
          if (onSelectCountry) {
            onSelectCountry(selection.details, selection.type, false);
          }
        }
      });

    // Draw Routes for all markets
    const allMarkets = [
      ...greenMarkets.map(m => ({ ...m, type: 'green' as const })),
      ...yellowMarkets.map(m => ({ ...m, type: 'yellow' as const })),
      ...redMarkets.map(m => ({ ...m, type: 'red' as const }))
    ];

    const originFeature = countries.features.find((f: any) => normalizeCountryName(f.properties.name) === normalizedOrigin);
    if (originFeature) {
      const originCentroid = path.centroid(originFeature);
      
      if (originCentroid && !isNaN(originCentroid[0])) {
        allMarkets.forEach((market, index) => {
          const normalizedDest = normalizeCountryName(market.country);
          const destFeature = countries.features.find((f: any) => normalizeCountryName(f.properties.name) === normalizedDest);
          
          if (destFeature) {
            const destCentroid = path.centroid(destFeature);
            if (destCentroid && !isNaN(destCentroid[0])) {
              const isActive = activeDestination === market.country || selectedCountry?.name === market.country;
              const isGreen = market.type === 'green';
              
              // Only draw if it's active or a green market (to avoid clutter)
              // Or draw all but with very low opacity for non-active
              const opacity = isActive ? 1 : (isGreen ? 0.4 : 0.15);
              
              const dx = destCentroid[0] - originCentroid[0];
              const dy = destCentroid[1] - originCentroid[1];
              const dr = Math.sqrt(dx * dx + dy * dy);
              
              if (dr < 10) return; // Skip if too close

              let d = '';
              if (selectedMode === 'air') {
                // Great circle-ish arc
                const midX = (originCentroid[0] + destCentroid[0]) / 2;
                const midY = (originCentroid[1] + destCentroid[1]) / 2 - (dr * 0.3); // Arc upwards
                d = `M${originCentroid[0]},${originCentroid[1]}Q${midX},${midY} ${destCentroid[0]},${destCentroid[1]}`;
              } else if (selectedMode === 'sea') {
                // Lower, more "fluid" curve
                const midX = (originCentroid[0] + destCentroid[0]) / 2;
                const midY = (originCentroid[1] + destCentroid[1]) / 2 + (dr * 0.2); // Arc downwards
                d = `M${originCentroid[0]},${originCentroid[1]}Q${midX},${midY} ${destCentroid[0]},${destCentroid[1]}`;
              } else {
                // Land: multi-segment "jagged" path
                const midX1 = originCentroid[0] + dx * 0.33 + (Math.random() * 20 - 10);
                const midY1 = originCentroid[1] + dy * 0.33 + (Math.random() * 20 - 10);
                const midX2 = originCentroid[0] + dx * 0.66 + (Math.random() * 20 - 10);
                const midY2 = originCentroid[1] + dy * 0.66 + (Math.random() * 20 - 10);
                d = `M${originCentroid[0]},${originCentroid[1]}L${midX1},${midY1}L${midX2},${midY2}L${destCentroid[0]},${destCentroid[1]}`;
              }

              const routeColor = selectedMode === 'air' ? '#6366f1' : selectedMode === 'sea' ? '#0ea5e9' : '#f59e0b';
              
              const routePath = g.append('path')
                .attr('d', d)
                .attr('fill', 'none')
                .attr('stroke', routeColor)
                .attr('stroke-width', isActive ? 2.5 : 1.5)
                .attr('stroke-dasharray', selectedMode === 'air' ? '6,4' : selectedMode === 'land' ? '2,2' : 'none')
                .attr('opacity', opacity)
                .attr('class', `route-line ${isActive ? 'active-route' : ''}`)
                .style('filter', isActive ? `drop-shadow(0 0 6px ${routeColor})` : 'none');

              // Animate the route entry
              const totalLength = (routePath.node() as SVGPathElement).getTotalLength();
              routePath
                .attr('stroke-dasharray', totalLength + ' ' + totalLength)
                .attr('stroke-dashoffset', totalLength)
                .transition()
                .delay(index * 100)
                .duration(1500)
                .ease(d3.easeCubicOut)
                .attr('stroke-dashoffset', 0)
                .on('end', () => {
                  // Reset dasharray after animation if it was dashed
                  if (selectedMode === 'air') routePath.attr('stroke-dasharray', '6,4');
                  else if (selectedMode === 'land') routePath.attr('stroke-dasharray', '2,2');
                  else routePath.attr('stroke-dasharray', 'none');
                });

              // Add animated particles/icons for active or green routes
              if (isActive || isGreen) {
                const particleCount = isActive ? 3 : 1;
                for (let i = 0; i < particleCount; i++) {
                  const iconGroup = g.append('g')
                    .attr('class', 'route-icon')
                    .attr('opacity', isActive ? 1 : 0.6);
                  
                  let iconPath = '';
                  if (selectedMode === 'air') {
                    iconPath = "M17.8 19.2L16 11L19.5 8.5C20.3 7.9 20.5 6.7 19.9 5.9C19.3 5.1 18.1 4.9 17.3 5.5L13.8 8L5.6 6.2L4.2 7.6L11 11.4L8.5 13.2L6 12.5L4.6 13.9L8.1 16.7L10.9 20.2L12.3 18.8L11.6 16.3L13.4 13.8L17.2 20.6L18.6 19.2H17.8Z";
                  } else if (selectedMode === 'sea') {
                    iconPath = "M2 21C2 21 7 18 12 18C17 18 22 21 22 21V11C22 11 17 8 12 8C7 8 2 11 2 11V21Z M12 2V8 M12 2L9 5 M12 2L15 5";
                  } else {
                    iconPath = "M14 18V20H10V18H14ZM19 18V20H15V18H19ZM9 18V20H5V18H9ZM19 10H5V16H19V10ZM19 8C20.1 8 21 8.9 21 10V16C21 17.1 20.1 18 19 18H5C3.9 18 3 17.1 3 16V10C3 8.9 3.9 8 5 8H19ZM17 4H7V8H17V4Z";
                  }

                  iconGroup.append('path')
                    .attr('d', iconPath)
                    .attr('fill', routeColor)
                    .attr('stroke', '#ffffff')
                    .attr('stroke-width', 0.5)
                    .attr('transform', 'scale(0.6) translate(-12, -12)');

                  const animateIcon = (delay: number) => {
                    iconGroup
                      .transition()
                      .delay(delay)
                      .duration(isActive ? 5000 : 8000)
                      .ease(d3.easeLinear)
                      .attrTween('transform', () => {
                        return (t) => {
                          const p = (routePath.node() as SVGPathElement).getPointAtLength(t * totalLength);
                          const pAfter = (routePath.node() as SVGPathElement).getPointAtLength(Math.min(totalLength, t * totalLength + 1));
                          const angle = Math.atan2(pAfter.y - p.y, pAfter.x - p.x) * 180 / Math.PI;
                          return `translate(${p.x},${p.y}) rotate(${angle})`;
                        };
                      })
                      .on('end', () => animateIcon(0));
                  };
                  animateIcon(i * 2000);
                }
              }

              // Add markers
              if (isActive) {
                g.append('circle')
                  .attr('cx', originCentroid[0])
                  .attr('cy', originCentroid[1])
                  .attr('r', 4)
                  .attr('fill', '#6366f1')
                  .attr('stroke', '#ffffff')
                  .attr('stroke-width', 1.5);

                const destMarker = g.append('circle')
                  .attr('cx', destCentroid[0])
                  .attr('cy', destCentroid[1])
                  .attr('r', 5)
                  .attr('fill', market.type === 'green' ? '#10b981' : market.type === 'yellow' ? '#f59e0b' : '#f43f5e')
                  .attr('stroke', '#ffffff')
                  .attr('stroke-width', 2)
                  .attr('class', 'dest-marker');
                
                const pulse = () => {
                  destMarker
                    .transition()
                    .duration(1000)
                    .attr('r', 8)
                    .attr('opacity', 0.3)
                    .transition()
                    .duration(1000)
                    .attr('r', 5)
                    .attr('opacity', 1)
                    .on('end', pulse);
                };
                pulse();
              }
            }
          }
        });
      }
    }
  }, [dimensions, greenMarkets, yellowMarkets, redMarkets, mapData, originCountry, activeDestination, selectedCountry, selectedMode]);

  return (
    <div ref={containerRef} className="relative w-full glass-card rounded-3xl overflow-hidden p-4 mb-8 min-h-[400px] flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 px-2">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Market Heatmap</h2>
          <p className="text-xs text-slate-500">Visualize trade routes and market viability</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex bg-slate-100 p-1 rounded-xl">
            <button 
              onClick={() => setSelectedMode('air')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${selectedMode === 'air' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Plane className="w-3.5 h-3.5" />
              Air
            </button>
            <button 
              onClick={() => setSelectedMode('sea')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${selectedMode === 'sea' ? 'bg-white text-sky-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Ship className="w-3.5 h-3.5" />
              Sea
            </button>
            <button 
              onClick={() => setSelectedMode('land')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${selectedMode === 'land' ? 'bg-white text-amber-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Truck className="w-3.5 h-3.5" />
              Land
            </button>
          </div>

          <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-wider">
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-emerald-500" /><span>Green</span></div>
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-amber-500" /><span>Yellow</span></div>
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-rose-500" /><span>Red</span></div>
          </div>
        </div>
      </div>
      
      <div className="flex-1 relative flex items-center justify-center">
        {mapError ? (
          <div className="flex flex-col items-center justify-center text-slate-400 p-8 text-center">
            <AlertCircle className="w-12 h-12 mb-4 text-rose-500" />
            <h3 className="text-lg font-bold text-slate-900 mb-2">Map Loading Failed</h3>
            <p className="text-sm max-w-xs">We couldn't load the world map. Please check your connection or try again later.</p>
          </div>
        ) : !mapData ? (
          <div className="w-8 h-8 border-2 border-emerald-100 border-t-emerald-600 rounded-full animate-spin" />
        ) : (
          <svg ref={svgRef} width={dimensions.width} height={dimensions.height} className="block" />
        )}
      </div>

      <AnimatePresence>
        {selectedCountry && (
          <motion.div key="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelectedCountry(null)} className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[150]" />
        )}
        {selectedCountry && (
          <motion.div key="modal-content" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 25, stiffness: 200 }} className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white shadow-2xl z-[160] overflow-y-auto">
            <div className="sticky top-0 bg-white/80 backdrop-blur-md border-b border-slate-100 p-6 flex items-center justify-between z-10">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${selectedCountry.type === 'green' ? 'bg-emerald-100 text-emerald-600' : selectedCountry.type === 'yellow' ? 'bg-amber-100 text-amber-600' : selectedCountry.type === 'red' ? 'bg-rose-100 text-rose-600' : selectedCountry.type === 'origin' ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-600'}`}>
                  <Globe className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-900">{selectedCountry.name}</h3>
                  <span className={`text-[10px] font-bold uppercase tracking-widest ${selectedCountry.type === 'green' ? 'text-emerald-600' : selectedCountry.type === 'yellow' ? 'text-amber-600' : selectedCountry.type === 'red' ? 'text-rose-600' : selectedCountry.type === 'origin' ? 'text-indigo-600' : 'text-slate-500'}`}>
                    {selectedCountry.type === 'green' ? 'Green Market' : selectedCountry.type === 'yellow' ? 'Yellow Market' : selectedCountry.type === 'red' ? 'Red Market' : selectedCountry.type === 'origin' ? 'Origin Country' : 'Neutral Market'}
                  </span>
                </div>
              </div>
              <button onClick={() => setSelectedCountry(null)} className="p-2 hover:bg-slate-100 rounded-full transition-colors"><X className="w-6 h-6 text-slate-400" /></button>
            </div>

            <div className="p-8 space-y-8">
              {selectedCountry.type === 'neutral' ? (
                <div className="text-center py-12"><Info className="w-12 h-12 text-slate-300 mx-auto mb-4" /><p className="text-slate-500">No specific trade data available for this country yet.</p></div>
              ) : (
                <>
                  <section className="space-y-4">
                    <div className="flex items-center gap-2 mb-6">
                      {selectedCountry.type === 'green' ? <TrendingUp className="w-5 h-5 text-emerald-600" /> : selectedCountry.type === 'red' ? <AlertTriangle className="w-5 h-5 text-rose-600" /> : <ShieldCheck className="w-5 h-5 text-amber-600" />}
                      <h3 className="text-lg font-bold text-slate-900">
                        {selectedCountry.type === 'green' ? 'Market Opportunity' : selectedCountry.type === 'red' ? 'Risk Assessment' : 'Market Status'}
                      </h3>
                    </div>
                    <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100">
                      <p className="text-sm text-slate-600 leading-relaxed italic">"{selectedCountry.details.why || selectedCountry.details.reason}"</p>
                    </div>
                    {selectedCountry.details.marketInsight && (
                      <div className="bg-indigo-50 rounded-2xl p-5 border border-indigo-100 mt-4">
                        <h4 className="text-sm font-bold text-indigo-900 flex items-center gap-2 mb-2">
                          <Info className="w-4 h-4 text-indigo-600" />
                          Market Insight
                        </h4>
                        <p className="text-sm text-indigo-800 leading-relaxed">{selectedCountry.details.marketInsight}</p>
                      </div>
                    )}
                  </section>

                  {selectedCountry.details.simulationParams && (
                    <ExportSimulator country={selectedCountry.name} params={selectedCountry.details.simulationParams} />
                  )}

                  {selectedCountry.details.tradeLaws && (
                    <section className="mt-8">
                      <div className="flex items-center gap-2 mb-6">
                        <ShieldCheck className="w-5 h-5 text-blue-500" />
                        <h3 className="text-lg font-bold text-slate-900">Regulatory Framework</h3>
                      </div>
                      <div className="space-y-6">
                        <div className="grid grid-cols-1 gap-6">
                          {selectedCountry.details.tradeLaws.importRegulations && (
                            <div className="space-y-2">
                              <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                                <FileText className="w-4 h-4 text-slate-400" />
                                Import Regulations
                              </h4>
                              <p className="text-sm text-slate-600 leading-relaxed pl-6">{selectedCountry.details.tradeLaws.importRegulations}</p>
                            </div>
                          )}
                          {selectedCountry.details.tradeLaws.exportRegulations && (
                            <div className="space-y-2">
                              <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                                <FileText className="w-4 h-4 text-slate-400" />
                                Export Regulations
                              </h4>
                              <p className="text-sm text-slate-600 leading-relaxed pl-6">{selectedCountry.details.tradeLaws.exportRegulations}</p>
                            </div>
                          )}
                          {selectedCountry.details.tradeLaws.customsDocumentation && (
                            <div className="space-y-2">
                              <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                                <FileText className="w-4 h-4 text-slate-400" />
                                Customs Documentation
                              </h4>
                              <p className="text-sm text-slate-600 leading-relaxed pl-6">{selectedCountry.details.tradeLaws.customsDocumentation}</p>
                            </div>
                          )}
                        </div>
                        
                        {selectedCountry.details.tradeLaws.prohibitionsAndRestrictions && (
                          <div className="p-6 bg-rose-50 rounded-2xl border border-rose-100">
                            <h4 className="text-sm font-bold text-rose-900 flex items-center gap-2 mb-2">
                              <AlertCircle className="w-4 h-4" />
                              Prohibitions & Restrictions
                            </h4>
                            <p className="text-sm text-rose-800 leading-relaxed">{selectedCountry.details.tradeLaws.prohibitionsAndRestrictions}</p>
                          </div>
                        )}

                        {selectedCountry.details.tradeLaws.requiredCertifications && (
                          <div className="p-6 bg-blue-50 rounded-2xl border border-blue-100">
                            <h4 className="text-sm font-bold text-blue-900 flex items-center gap-2 mb-2">
                              <ShieldCheck className="w-4 h-4" />
                              Required Certifications
                            </h4>
                            <p className="text-sm text-blue-800 leading-relaxed">{selectedCountry.details.tradeLaws.requiredCertifications}</p>
                          </div>
                        )}
                      </div>
                    </section>
                  )}

                  <div className="pt-8 border-t border-slate-100">
                    <button
                      onClick={() => {
                        if (onSelectCountry) {
                          onSelectCountry(selectedCountry.details, selectedCountry.type, true);
                        }
                      }}
                      disabled={isAnalyzing}
                      className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition-all shadow-lg shadow-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isAnalyzing ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Analyzing Market...
                        </>
                      ) : (
                        <>
                          <BookOpen className="w-5 h-5" />
                          View Full Market Analysis
                        </>
                      )}
                    </button>
                    <p className="text-[10px] text-slate-400 text-center mt-3 uppercase tracking-widest font-bold">
                      Includes Logistics, Compliance & Financials
                    </p>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}

        {hoveredCountry && (
          <motion.div
            key="hover-sidebar"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="absolute top-4 right-4 bottom-4 w-80 bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-slate-100 p-6 overflow-y-auto z-10 pointer-events-none"
          >
            <div className="flex items-center justify-between gap-4 mb-4">
              <h4 className="font-bold text-lg text-slate-900">{hoveredCountry.name}</h4>
              <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                hoveredCountry.type === 'green' ? 'bg-emerald-100 text-emerald-600' : 
                hoveredCountry.type === 'yellow' ? 'bg-amber-100 text-amber-600' : 
                hoveredCountry.type === 'red' ? 'bg-rose-100 text-rose-600' : 
                hoveredCountry.type === 'origin' ? 'bg-indigo-100 text-indigo-600' : 
                'bg-slate-100 text-slate-600'
              }`}>
                {hoveredCountry.type}
              </span>
            </div>

            {hoveredCountry.type === 'neutral' ? (
              <div className="text-center py-8">
                <Info className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                <p className="text-sm text-slate-500">No specific trade data available.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                  <p className="text-sm text-slate-600 leading-relaxed italic">
                    "{hoveredCountry.details?.why || hoveredCountry.details?.reason}"
                  </p>
                </div>
                
                {hoveredCountry.details?.marketInsight && (
                  <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-100">
                    <h5 className="text-xs font-bold text-indigo-900 flex items-center gap-1.5 mb-2">
                      <Info className="w-3.5 h-3.5 text-indigo-600" />
                      Market Insight
                    </h5>
                    <p className="text-xs text-indigo-800 leading-relaxed">
                      {hoveredCountry.details.marketInsight}
                    </p>
                  </div>
                )}

                <div className="text-center pt-4 border-t border-slate-100">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    Click country for full analysis
                  </p>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default WorldMap;
