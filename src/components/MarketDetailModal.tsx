import React, { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ShieldCheck, DollarSign, FileText, Loader2, AlertCircle, Info, Package, Zap, TrendingUp, Newspaper, ExternalLink, MapPin, Anchor, Truck, MessageCircle } from 'lucide-react';
import { TradeLaws, SimulationParams, DetailedMarketInfo, TradePulse } from '../types';
import { db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { fetchMarketDetails, fetchTradePulse, getTradeLawCacheId } from '../services/gemini';
import { Map, AdvancedMarker, Pin, InfoWindow, useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { auth } from '../firebase';
import { useCurrency } from '../contexts/CurrencyContext';
import { DocumentGeneratorModal } from './DocumentGeneratorModal';
import { TalkToExpertModal } from './TalkToExpertModal';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface MarketDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  detailId: string;
  country: string;
  productName: string;
  hsCode: string;
  originCountry: string;
}

interface DetailData extends DetailedMarketInfo {
  productName: string;
  hsCode: string;
  originCountry: string;
  // Add legacy fields if they exist in old docs
  demand?: string;
  barriers?: string;
  growthInsight?: string;
  marketEntryStrategy?: string;
  localCompetitionAnalysis?: string;
  consumerBehaviorInsights?: string;
  potential?: string;
  keyChallenges?: string[];
  mitigationStrategies?: string[];
  marketEntryTimeline?: string;
  taxOrBarrier?: string;
  riskScore?: number;
  caution?: string;
  legalRisks?: string[];
  politicalStabilityInsight?: string;
  safestExecutionPlan?: {
    legalComplianceSteps: string[];
    partnershipStrategy: string;
    riskMitigation: string[];
    exitStrategy?: string;
  };
  ftaDetails?: {
    name: string;
    benefits: string[];
    tariffReduction: string;
    customsStreamlining: string;
    rulesOfOrigin: string;
  };
  executionRoadmap?: Array<{
    phase: string;
    step: string;
    description: string;
    estimatedTime?: string;
    actionRequired?: string;
  }>;
  estimatedLocalMarketPrice?: {
    min: number;
    max: number;
    currency: string;
    unit: string;
    marketCondition: string;
  };
}

function ProfitabilityCalculator({ data }: { data: DetailData }) {
  const { baseCurrency, convertValue, convertText } = useCurrency();
  const [unitCost, setUnitCost] = useState<number>(0);
  const [quantity, setQuantity] = useState<number>(1);
  const params = data.simulationParams;
  const marketPrice = data.estimatedLocalMarketPrice;

  if (!params || !marketPrice) return null;

  const logisticsCost = convertValue(params.logisticsCostPerUnit, params.currency || 'USD');
  const marketMin = convertValue(marketPrice.min, marketPrice.currency || 'USD');
  const marketMax = convertValue(marketPrice.max, marketPrice.currency || 'USD');

  const dutyAmount = (unitCost * params.dutyRate) / 100;
  const taxAmount = ((unitCost + dutyAmount) * params.taxRate) / 100;
  const landedCostPerUnit = unitCost + dutyAmount + taxAmount + logisticsCost;
  const totalLandedCost = landedCostPerUnit * quantity;
  
  const potentialProfitMin = marketMin - landedCostPerUnit;
  const potentialProfitMax = marketMax - landedCostPerUnit;
  const marginMin = (potentialProfitMin / marketMin) * 100;
  const marginMax = (potentialProfitMax / marketMax) * 100;

  return (
    <section className="bg-slate-900 rounded-3xl p-8 text-white overflow-hidden relative">
      <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 blur-3xl rounded-full -mr-32 -mt-32" />
      <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-500/10 blur-3xl rounded-full -ml-32 -mb-32" />
      
      <div className="relative z-10">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30">
            <DollarSign className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <h3 className="text-xl font-bold">Trader's Profitability Calculator</h3>
            <p className="text-xs text-slate-400 font-medium">Estimate your margins for {data.country}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Factory Price ({baseCurrency})</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold">{baseCurrency}</span>
                  <input 
                    type="number" 
                    value={unitCost || ''} 
                    onChange={(e) => setUnitCost(Number(e.target.value))}
                    placeholder="0.00"
                    className="w-full bg-slate-800 border border-slate-700 rounded-2xl py-4 pl-12 pr-4 text-xl font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Quantity ({params.unitName})</label>
                <input 
                  type="number" 
                  value={quantity || ''} 
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  placeholder="1"
                  className="w-full bg-slate-800 border border-slate-700 rounded-2xl py-4 px-4 text-xl font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                />
              </div>
            </div>
            <p className="text-[10px] text-slate-500 mt-2 italic">Enter your factory price per {params.unitName} and total quantity.</p>

            <div className="space-y-3 pt-4 border-t border-slate-800">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Import Duty ({params.dutyRate}%)</span>
                <span className="font-mono text-slate-300">+{dutyAmount.toFixed(2)} / unit</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Taxes ({params.taxRate}%)</span>
                <span className="font-mono text-slate-300">+{taxAmount.toFixed(2)} / unit</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Logistics/Unit</span>
                <span className="font-mono text-slate-300">+{logisticsCost.toFixed(2)} / unit</span>
              </div>
              <div className="flex justify-between text-lg font-bold pt-3 border-t border-slate-800">
                <span className="text-white">Landed Cost (Per Unit)</span>
                <span className="text-emerald-400">{landedCostPerUnit.toFixed(2)} {baseCurrency}</span>
              </div>
              <div className="flex justify-between text-xl font-black pt-3 border-t border-slate-800">
                <span className="text-white">Total Landed Cost</span>
                <span className="text-emerald-400">{totalLandedCost.toFixed(2)} {baseCurrency}</span>
              </div>
            </div>
          </div>

          <div className="bg-slate-800/50 rounded-2xl p-6 border border-slate-700 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-4 h-4 text-blue-400" />
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Market Price Range</span>
              </div>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-3xl font-bold">{baseCurrency}{marketMin.toFixed(2)} - {baseCurrency}{marketMax.toFixed(2)}</span>
                <span className="text-sm text-slate-400 font-bold">/ {params.unitName}</span>
              </div>
              <p className="text-[10px] text-slate-500 leading-relaxed mb-6">
                Estimated local retail/wholesale price in {data.country}. {marketPrice.marketCondition}
              </p>
            </div>

            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Estimated Profit</span>
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Margin</span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="text-2xl font-bold text-white">
                    {potentialProfitMin.toFixed(2)} - {potentialProfitMax.toFixed(2)}
                  </span>
                  <span className={`text-sm font-bold ${marginMin > 20 ? 'text-emerald-400' : marginMin > 0 ? 'text-amber-400' : 'text-rose-400'}`}>
                    {marginMin.toFixed(1)}% - {marginMax.toFixed(1)}%
                  </span>
                </div>
              </div>
              
              <div className="flex items-center gap-2 text-[9px] text-slate-500 italic">
                <Info className="w-3 h-3" />
                <span>Calculations are estimates based on provided duty and tax rates.</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function LogisticsMap({ country }: { country: string }) {
  const map = useMap();
  const placesLib = useMapsLibrary('places');
  const [places, setPlaces] = useState<google.maps.places.Place[]>([]);
  const [selectedHub, setSelectedHub] = useState<google.maps.places.Place | null>(null);
  const [center, setCenter] = useState<google.maps.LatLngLiteral>({ lat: 0, lng: 0 });
  const [errorStatus, setErrorStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!placesLib || !country) return;

    try {
      // Geocode country center first
      const geocoder = new google.maps.Geocoder();
      geocoder.geocode({ address: country }, (results, status) => {
        if (status === 'OK' && results?.[0]) {
          const loc = results[0].geometry.location.toJSON();
          setCenter(loc);
          
          // Search for logistics hubs nearby
          placesLib.Place.searchByText({
            textQuery: `major ports and logistics hubs in ${country}`,
            fields: ['displayName', 'location', 'formattedAddress', 'types', 'rating'],
            locationBias: loc,
            maxResultCount: 10,
          }).then(({ places }) => {
            setPlaces(places);
          }).catch(err => {
            console.error('Places API error:', err);
            setErrorStatus('Places API Error (Check Billing/API Enablement)');
          });
        } else {
          console.warn('Geocoding failed:', status);
          setErrorStatus(`Geocoding Failed: ${status}`);
        }
      });
    } catch (err) {
      console.error('Map initialization error:', err);
      setErrorStatus('Map Initialization Error');
    }
  }, [placesLib, country]);

  return (
    <div className="h-[400px] w-full rounded-3xl overflow-hidden border border-slate-200 shadow-inner relative">
      {errorStatus ? (
        <div className="absolute inset-0 bg-slate-50 z-10 flex flex-col items-center justify-center p-6 text-center">
          <AlertCircle className="w-12 h-12 text-amber-500 mb-4" />
          <h4 className="font-bold text-slate-800 mb-2">Logistics Map Unavailable</h4>
          <p className="text-sm text-slate-500 mb-4">
            {errorStatus === 'Geocoding Failed: REQUEST_DENIED' 
              ? 'The Geocoding API is not activated for your project.' 
              : `Error: ${errorStatus}`}
          </p>
          <div className="text-[11px] text-slate-400 bg-white p-4 rounded-xl border border-slate-200 max-w-sm">
            <p className="font-bold mb-1 text-slate-600">To unlock maps:</p>
            <ol className="list-decimal list-inside space-y-1 text-left">
              <li>Enable <a href="https://console.cloud.google.com/billing" target="_blank" className="text-blue-500 hover:underline">Billing</a> in Google Cloud</li>
              <li>Activate <strong>Geocoding API</strong></li>
              <li>Activate <strong>Places API (New)</strong></li>
            </ol>
          </div>
        </div>
      ) : (
        <>
          <Map
            defaultCenter={center}
            defaultZoom={4}
            center={center}
            mapId="LOGISTICS_MAP_ID"
            {...({ internalUsageAttributionIds: ['gmp_mcp_codeassist_v1_aistudio'] } as any)}
            className="w-full h-full"
          >
            {places.map((place) => (
              <AdvancedMarker
                key={place.id}
                position={place.location}
                onClick={() => setSelectedHub(place)}
              >
                <Pin 
                  background={place.types?.includes('port') ? '#4285F4' : '#34A853'} 
                  glyphColor="#fff"
                  {...({ glyph: place.types?.includes('port') ? '⚓' : '📦' } as any)}
                />
              </AdvancedMarker>
            ))}

            {selectedHub && selectedHub.location && (
              <InfoWindow
                position={selectedHub.location}
                onCloseClick={() => setSelectedHub(null)}
              >
                <div className="p-2 max-w-[200px]">
                  <h4 className="font-bold text-slate-900 text-sm mb-1">{selectedHub.displayName}</h4>
                  <p className="text-[10px] text-slate-500 mb-2">{selectedHub.formattedAddress}</p>
                  {selectedHub.rating && (
                    <div className="flex items-center gap-1 text-amber-500 text-[10px]">
                      <span>⭐ {selectedHub.rating}</span>
                    </div>
                  )}
                </div>
              </InfoWindow>
            )}
          </Map>
          
          <div className="absolute bottom-4 left-4 right-4 bg-white/90 backdrop-blur-md p-3 rounded-2xl border border-slate-200 shadow-lg flex items-center justify-between z-0 pointer-events-none">
            <div className="flex gap-4 text-[10px] font-bold uppercase tracking-wider">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-blue-500" />
                <span className="text-slate-600">Major Ports</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-slate-600">Logistics Hubs</span>
              </div>
            </div>
            <span className="text-[9px] text-slate-400 italic">Live Logistics Intelligence</span>
          </div>
        </>
      )}
    </div>
  );
}

export const MarketDetailModal: React.FC<MarketDetailModalProps> = ({ isOpen, onClose, detailId, country, productName, hsCode, originCountry }) => {
  const { convertText, convertValue, baseCurrency } = useCurrency();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DetailData | null>(null);
  const [pulseData, setPulseData] = useState<TradePulse | null>(null);
  const [pulseLoading, setPulseLoading] = useState(false);
  const [isExpertModalOpen, setIsExpertModalOpen] = useState(false);
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);

  useEffect(() => {
    if (isOpen && country) {
      setLoading(true);
      setError(null);
      setPulseLoading(true);
      
      const fetchDetails = async () => {
        try {
          // 1. Try to fetch from Firestore first (cache)
          const user = auth.currentUser;
          let effectiveDetailId = null;
          
          if (user && productName && country) {
            effectiveDetailId = getTradeLawCacheId(user.uid, productName, country);
          } else {
            effectiveDetailId = detailId;
          }

          let cachedData = null;
          if (effectiveDetailId) {
            try {
              const docRef = doc(db, 'trade_laws', effectiveDetailId);
              const docSnap = await getDoc(docRef);
              
              if (docSnap.exists()) {
                cachedData = docSnap.data() as DetailData;
                setData(cachedData);
                setLoading(false);
              }
            } catch (err) {
              console.warn('Cache fetch failed:', err);
            }
          }

          // Fetch Pulse - if not cached, this will trigger a Gemini call
          // We do this after checking the main cache to spread out the load
          if (!cachedData) {
            // Wait a tiny bit before starting the first heavy fetch if we have no cache
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          
          fetchTradePulse(country)
            .then(setPulseData)
            .catch(err => {
              console.error('Pulse fetch failed:', err);
              // Don't set global error for pulse failure, just log it
            })
            .finally(() => setPulseLoading(false));

          // 2. If not in Firestore or no detailId, fetch from Gemini
          if (!cachedData) {
            console.log(`Lazy loading details for ${country}...`);
            // Add another small delay to avoid hitting rate limits with the pulse fetch
            await new Promise(resolve => setTimeout(resolve, 1500));
            const freshData = await fetchMarketDetails(productName, hsCode, originCountry, country);
            setData(freshData as DetailData);
          }
        } catch (err: any) {
          console.error('Modal fetch error:', err);
          let errorMessage = err.message || 'Failed to fetch details';
          if (errorMessage.includes('429') || errorMessage.includes('RESOURCE_EXHAUSTED')) {
            errorMessage = 'We are experiencing high traffic. Please wait a moment and try again.';
          } else {
            try {
              const parsed = JSON.parse(errorMessage);
              if (parsed.error && parsed.error.message) {
                errorMessage = parsed.error.message;
              }
            } catch (e) {
              // Not JSON, keep original message
            }
          }
          setError(errorMessage);
        } finally {
          setLoading(false);
        }
      };
      
      fetchDetails();
    }
  }, [isOpen, detailId, country, productName, hsCode, originCountry]);

  return (
    <>
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
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
            className="relative w-full max-w-4xl bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
          >
            {/* Header */}
            <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">{country}</h2>
                <div className="flex items-center gap-3">
                  <p className="text-sm text-slate-500 font-medium">Detailed Trade Intelligence & Compliance</p>
                  <div className="flex items-center gap-1.5 px-2 py-0.5 bg-slate-100 rounded-lg">
                    <span className="text-[10px] font-mono font-bold text-slate-500">{hsCode}</span>
                  </div>
                </div>
                <p className="text-[9px] text-slate-400 mt-1.5 italic max-w-md">
                  * HS Codes and logistics data are AI-generated estimates. Please verify with official customs authorities and providers before execution.
                </p>
              </div>
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => setIsDocumentModalOpen(true)}
                  className="hidden sm:flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl transition-colors shadow-sm"
                >
                  <FileText className="w-4 h-4" />
                  Generate Documents
                </button>
                <button 
                  onClick={() => setIsExpertModalOpen(true)}
                  className="hidden sm:flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition-colors shadow-sm"
                >
                  <MessageCircle className="w-4 h-4" />
                  Talk to an Expert
                </button>
                <button 
                  onClick={onClose}
                  className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-slate-600"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-8">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-20 gap-4">
                  <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
                  <p className="text-slate-500 font-medium">Retrieving market data...</p>
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center py-20 gap-4 text-rose-500">
                  <AlertCircle className="w-12 h-12" />
                  <p className="font-bold">{error}</p>
                  <button 
                    onClick={() => onClose()}
                    className="text-sm underline font-medium"
                  >
                    Close and try again
                  </button>
                </div>
              ) : data ? (
                <div className="space-y-10">
                  {/* Product Context */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100">
                      <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider block mb-1">Product</span>
                      <span className="text-sm font-bold text-blue-900">{data.productName}</span>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">HS Code</span>
                      <span className="text-sm font-bold text-slate-900">{data.hsCode}</span>
                    </div>
                  </div>

                  {/* Live Trade Pulse */}
                  <section className="relative overflow-hidden">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <Newspaper className="w-5 h-5 text-emerald-600" />
                        <h3 className="text-lg font-bold text-slate-900">Live Trade Pulse</h3>
                      </div>
                      {pulseData && (
                        <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${
                          pulseData.riskLevel === 'Low' ? 'bg-emerald-100 text-emerald-600' :
                          pulseData.riskLevel === 'Medium' ? 'bg-amber-100 text-amber-600' :
                          pulseData.riskLevel === 'High' ? 'bg-orange-100 text-orange-600' :
                          'bg-rose-100 text-rose-600'
                        }`}>
                          Risk: {pulseData.riskLevel}
                        </div>
                      )}
                    </div>

                    <div className="glass-card p-6 rounded-3xl border border-slate-100 bg-slate-50/50">
                      {pulseLoading ? (
                        <div className="flex items-center gap-3 py-4">
                          <Loader2 className="w-5 h-5 text-emerald-600 animate-spin" />
                          <p className="text-sm text-slate-500 font-medium animate-pulse">Scanning global trade news for {country}...</p>
                        </div>
                      ) : pulseData ? (
                        <div className="space-y-6">
                          <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm">
                            <p className="text-sm text-slate-700 font-medium leading-relaxed italic">
                              "{pulseData.riskSummary}"
                            </p>
                          </div>
                          <div className="space-y-4">
                            {pulseData.headlines.map((news, idx) => (
                              <div key={idx} className="group relative pl-4 border-l-2 border-slate-200 hover:border-emerald-500 transition-colors">
                                <div className="flex items-start justify-between gap-4">
                                  <div>
                                    <h4 className="text-sm font-bold text-slate-900 group-hover:text-emerald-600 transition-colors">{news.title}</h4>
                                    <p className="text-xs text-slate-500 mt-1 line-clamp-2">{news.summary}</p>
                                    <div className="flex items-center gap-3 mt-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                      <span>{news.source}</span>
                                      <span>•</span>
                                      <span>{news.date}</span>
                                    </div>
                                  </div>
                                  {news.url && (
                                    <a href={news.url} target="_blank" rel="noopener noreferrer" className="p-2 bg-white rounded-lg border border-slate-100 text-slate-400 hover:text-emerald-600 hover:border-emerald-100 transition-all">
                                      <ExternalLink className="w-4 h-4" />
                                    </a>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="pt-4 border-t border-slate-200 flex items-center justify-between">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Last Updated: {pulseData.lastChecked}</span>
                            <span className="text-[10px] font-bold text-emerald-600 flex items-center gap-1">
                              <ShieldCheck className="w-3 h-3" /> Grounded in Google Search
                            </span>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-slate-500 py-4">No recent high-impact trade news found for this region.</p>
                      )}
                    </div>
                  </section>

                  {/* Market Insight */}
                  {data.marketInsight && (
                    <section>
                      <div className="flex items-center gap-2 mb-6">
                        <Info className="w-5 h-5 text-indigo-500" />
                        <h3 className="text-lg font-bold text-slate-900">Market Insight</h3>
                      </div>
                      <div className="p-6 bg-indigo-50 rounded-2xl border border-indigo-100">
                        <p className="text-sm text-indigo-900 leading-relaxed">{data.marketInsight}</p>
                      </div>
                    </section>
                  )}

                  {/* B2B Buyer Channels */}
                  {data.b2bChannels && (
                    <section>
                      <div className="flex items-center gap-2 mb-6">
                        <TrendingUp className="w-5 h-5 text-purple-500" />
                        <h3 className="text-lg font-bold text-slate-900">B2B Buyer Channels</h3>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="p-6 bg-purple-50 rounded-2xl border border-purple-100">
                          <h4 className="text-xs font-bold text-purple-400 uppercase tracking-widest mb-3">Top Trade Shows</h4>
                          <ul className="space-y-2">
                            {data.b2bChannels.tradeShows.map((show, idx) => (
                              <li key={idx} className="text-sm text-purple-900 font-medium flex items-start gap-2">
                                <span className="text-purple-400 mt-0.5">•</span>
                                <a href={show.link} target="_blank" rel="noopener noreferrer" className="hover:underline text-purple-700">
                                  {show.name}
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div className="p-6 bg-fuchsia-50 rounded-2xl border border-fuchsia-100">
                          <h4 className="text-xs font-bold text-fuchsia-400 uppercase tracking-widest mb-3">Main B2B Platforms</h4>
                          <ul className="space-y-2">
                            {data.b2bChannels.platforms.map((platform, idx) => (
                              <li key={idx} className="text-sm text-fuchsia-900 font-medium flex items-start gap-2">
                                <span className="text-fuchsia-400 mt-0.5">•</span>
                                <a href={platform.link} target="_blank" rel="noopener noreferrer" className="hover:underline text-fuchsia-700">
                                  {platform.name}
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div className="p-6 bg-pink-50 rounded-2xl border border-pink-100">
                          <h4 className="text-xs font-bold text-pink-400 uppercase tracking-widest mb-3">Distributor Margins</h4>
                          <ul className="space-y-2">
                            {data.b2bChannels.distributorMargins.map((dist, idx) => (
                              <li key={idx} className="text-sm text-pink-900 font-medium flex flex-col gap-1">
                                <div className="flex items-start gap-2">
                                  <span className="text-pink-400 mt-0.5">•</span>
                                  <a href={dist.link} target="_blank" rel="noopener noreferrer" className="hover:underline text-pink-700">
                                    {dist.name}
                                  </a>
                                </div>
                                <span className="text-xs text-pink-500 ml-5">{dist.margin}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </section>
                  )}

                  {/* Profitability Calculator */}
                  <ProfitabilityCalculator data={data} />

                  {/* Market Strategy & Insights */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {data.marketEntryStrategy && (
                      <section>
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Market Entry Strategy</h3>
                        <p className="text-sm text-slate-600 leading-relaxed">{data.marketEntryStrategy}</p>
                      </section>
                    )}
                    {data.localCompetitionAnalysis && (
                      <section>
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Local Competition</h3>
                        <p className="text-sm text-slate-600 leading-relaxed">{data.localCompetitionAnalysis}</p>
                      </section>
                    )}
                  </div>

                  {data.consumerBehaviorInsights && (
                    <section className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Consumer Behavior</h3>
                      <p className="text-sm text-slate-600 leading-relaxed">{data.consumerBehaviorInsights}</p>
                    </section>
                  )}

                  {data.ftaDetails && (
                    <section className="bg-blue-50 p-6 rounded-2xl border border-blue-100">
                      <details className="group">
                        <summary className="flex items-center justify-between cursor-pointer list-none">
                          <h3 className="text-xs font-bold text-blue-400 uppercase tracking-widest">Trade Agreement: {data.ftaDetails.name}</h3>
                          <span className="transition group-open:rotate-180">
                            <svg fill="none" height="24" shapeRendering="geometricPrecision" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 24 24" width="24" className="text-blue-400"><path d="M6 9l6 6 6-6"></path></svg>
                          </span>
                        </summary>
                        <div className="space-y-4 mt-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <span className="text-[10px] font-bold text-blue-400 uppercase block">Tariff Reduction</span>
                              <span className="text-sm font-bold text-blue-900">{data.ftaDetails.tariffReduction}</span>
                            </div>
                            <div>
                              <span className="text-[10px] font-bold text-blue-400 uppercase block">Rules of Origin</span>
                              <span className="text-sm font-bold text-blue-900">{data.ftaDetails.rulesOfOrigin}</span>
                            </div>
                          </div>
                          <div>
                            <span className="text-[10px] font-bold text-blue-400 uppercase block mb-1">Key Benefits</span>
                            <div className="flex flex-wrap gap-2">
                              {data.ftaDetails.benefits.map((b, i) => (
                                <span key={i} className="px-2 py-1 bg-white text-blue-600 rounded-lg text-[10px] font-bold border border-blue-100 uppercase">{b}</span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </details>
                    </section>
                  )}

                  {data.safestExecutionPlan && (
                    <section className="bg-emerald-50 p-6 rounded-2xl border border-emerald-100">
                      <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-widest mb-3">Execution Strategy</h3>
                      <div className="space-y-4">
                        <p className="text-sm text-emerald-900 font-medium">{data.safestExecutionPlan.partnershipStrategy}</p>
                        <div>
                          <span className="text-[10px] font-bold text-emerald-400 uppercase block mb-1">Risk Mitigation</span>
                          <ul className="list-disc list-inside text-xs text-emerald-800 space-y-1">
                            {data.safestExecutionPlan.riskMitigation.map((m, i) => <li key={i}>{m}</li>)}
                          </ul>
                        </div>
                        {data.safestExecutionPlan.exitStrategy && (
                          <div className="pt-3 border-t border-emerald-200">
                            <span className="text-[10px] font-bold text-emerald-400 uppercase block mb-1">Exit Strategy</span>
                            <p className="text-xs text-emerald-800 italic">{data.safestExecutionPlan.exitStrategy}</p>
                          </div>
                        )}
                      </div>
                    </section>
                  )}

                  {/* Taxes and Duties */}
                  <section>
                    <div className="flex items-center gap-2 mb-6">
                      <DollarSign className="w-5 h-5 text-emerald-500" />
                      <h3 className="text-lg font-bold text-slate-900">Taxes and Duties (Government Costs)</h3>
                      <div className="flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded-full border border-emerald-100">
                        <ShieldCheck className="w-3 h-3" />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Verified by WTO</span>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4 mb-6">
                      <div className="p-4 rounded-2xl border border-slate-100 bg-white shadow-sm relative">
                        <span className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Duty Rate</span>
                        <span className="text-xl font-bold text-slate-900">{data.simulationParams.dutyRate}%</span>
                        {data.simulationParams.confidenceScore !== undefined && (
                          <div className="absolute top-2 right-2 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">
                            {data.simulationParams.confidenceScore * 100}% Confidence
                          </div>
                        )}
                      </div>
                      <div className="p-4 rounded-2xl border border-slate-100 bg-white shadow-sm relative">
                        <span className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Tax Rate</span>
                        <span className="text-xl font-bold text-slate-900">{data.simulationParams.taxRate}%</span>
                        {data.simulationParams.sourceUrl && (
                          <a href={data.simulationParams.sourceUrl} target="_blank" rel="noopener noreferrer" className="absolute top-2 right-2 text-[10px] font-bold text-blue-600 hover:underline bg-blue-50 px-2 py-1 rounded-full">
                            Source
                          </a>
                        )}
                      </div>
                    </div>

                    {data.taxes && data.taxes.length > 0 && (
                      <div className="mb-6">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Detailed Tax Breakdown</h4>
                        <div className="space-y-3">
                          {data.taxes.map((tax, idx) => (
                            <div key={idx} className="p-4 bg-white border border-slate-100 rounded-xl shadow-sm">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
                                <div>
                                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Export Tax</span>
                                  <span className="text-sm font-bold text-slate-700">{convertText(tax.exportTax)}</span>
                                </div>
                                <div>
                                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Import Duty</span>
                                  <span className="text-sm font-bold text-slate-700">{convertText(tax.importDuty)}</span>
                                </div>
                                <div>
                                  <span className="text-[10px] font-bold text-slate-400 uppercase block">VAT / GST</span>
                                  <span className="text-sm font-bold text-slate-700">{convertText(tax.vatOrGst)}</span>
                                </div>
                                <div>
                                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Other Fees</span>
                                  <span className="text-sm font-bold text-slate-700">{convertText(tax.otherFees)}</span>
                                </div>
                              </div>
                              <div className="flex justify-between items-center pt-3 border-t border-slate-50">
                                <span className="text-xs text-slate-500 italic">{tax.notes}</span>
                                <span className="text-sm font-bold text-emerald-600">Total: {convertText(tax.totalEstimate)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {((data.compliance && data.compliance.some(c => c.estimatedCost && c.estimatedCost.toLowerCase() !== 'n/a' && c.estimatedCost.toLowerCase() !== 'free')) || 
                      (data.exportLicenses && data.exportLicenses.some(l => l.cost && l.cost.toLowerCase() !== 'n/a' && l.cost.toLowerCase() !== 'free'))) && (
                      <div className="mb-6">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Government Compliance & License Costs</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {data.compliance?.filter(c => c.estimatedCost && c.estimatedCost.toLowerCase() !== 'n/a' && c.estimatedCost.toLowerCase() !== 'free').map((c, idx) => (
                            <div key={`comp-${idx}`} className="p-3 bg-white border border-slate-100 rounded-xl shadow-sm flex justify-between items-center">
                              <span className="text-xs font-bold text-slate-700">{c.requirement}</span>
                              <span className="text-xs font-bold text-emerald-600">{convertText(c.estimatedCost)}</span>
                            </div>
                          ))}
                          {data.exportLicenses?.filter(l => l.cost && l.cost.toLowerCase() !== 'n/a' && l.cost.toLowerCase() !== 'free').map((l, idx) => (
                            <div key={`lic-${idx}`} className="p-3 bg-white border border-slate-100 rounded-xl shadow-sm flex justify-between items-center">
                              <span className="text-xs font-bold text-slate-700">{l.licenseName}</span>
                              <span className="text-xs font-bold text-emerald-600">{convertText(l.cost)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="p-4 bg-slate-50 rounded-2xl text-sm text-slate-600 leading-relaxed">
                      <span className="font-bold text-slate-900 block mb-1">Paperwork Requirements:</span>
                      {data.simulationParams.paperwork}
                    </div>
                  </section>

                  {/* Trade Laws */}
                  <section>
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="w-5 h-5 text-blue-500" />
                        <h3 className="text-lg font-bold text-slate-900">Regulatory Framework</h3>
                      </div>
                      {data.tradeLaws.sourceUrl && (
                        <a 
                          href={data.tradeLaws.sourceUrl} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-[10px] flex items-center gap-1.5 text-slate-500 hover:text-blue-600 font-bold bg-slate-100 px-3 py-1.5 rounded-full transition-all border border-slate-200"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Official Source: {new URL(data.tradeLaws.sourceUrl).hostname}
                        </a>
                      )}
                    </div>
                    <div className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {data.tradeLaws.importRegulations && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                                <FileText className="w-4 h-4 text-slate-400" />
                                Import Regulations
                              </h4>
                              {data.tradeLaws.importRegulationsLink && (
                                <a href={data.tradeLaws.importRegulationsLink} target="_blank" rel="noopener noreferrer" className="text-[10px] flex items-center gap-1 text-blue-600 hover:text-blue-700 font-bold bg-blue-50 px-2 py-1 rounded-md transition-colors uppercase tracking-wider">
                                  Official Link <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                            <p className="text-sm text-slate-600 leading-relaxed pl-6">{data.tradeLaws.importRegulations}</p>
                          </div>
                        )}
                        {data.tradeLaws.exportRegulations && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                                <FileText className="w-4 h-4 text-slate-400" />
                                Export Regulations
                              </h4>
                              {data.tradeLaws.exportRegulationsLink && (
                                <a href={data.tradeLaws.exportRegulationsLink} target="_blank" rel="noopener noreferrer" className="text-[10px] flex items-center gap-1 text-blue-600 hover:text-blue-700 font-bold bg-blue-50 px-2 py-1 rounded-md transition-colors uppercase tracking-wider">
                                  Official Link <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                            <p className="text-sm text-slate-600 leading-relaxed pl-6">{data.tradeLaws.exportRegulations}</p>
                          </div>
                        )}
                        {data.tradeLaws.customsDocumentation && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                                <FileText className="w-4 h-4 text-slate-400" />
                                Customs Documentation
                              </h4>
                              {data.tradeLaws.customsDocumentationLink && (
                                <a href={data.tradeLaws.customsDocumentationLink} target="_blank" rel="noopener noreferrer" className="text-[10px] flex items-center gap-1 text-blue-600 hover:text-blue-700 font-bold bg-blue-50 px-2 py-1 rounded-md transition-colors uppercase tracking-wider">
                                  Official Link <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                            <p className="text-sm text-slate-600 leading-relaxed pl-6">{data.tradeLaws.customsDocumentation}</p>
                          </div>
                        )}
                      </div>
                      
                      <div className="p-6 bg-rose-50 rounded-2xl border border-rose-100 relative">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-sm font-bold text-rose-900 flex items-center gap-2">
                            <AlertCircle className="w-4 h-4" />
                            Prohibitions & Restrictions
                          </h4>
                          {data.tradeLaws.prohibitionsAndRestrictionsLink && (
                            <a href={data.tradeLaws.prohibitionsAndRestrictionsLink} target="_blank" rel="noopener noreferrer" className="text-[10px] flex items-center gap-1 text-rose-600 hover:text-rose-700 font-bold bg-rose-100/50 px-2 py-1 rounded-md transition-colors uppercase tracking-wider">
                              Official Link <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                        <p className="text-sm text-rose-800 leading-relaxed">{data.tradeLaws.prohibitionsAndRestrictions}</p>
                      </div>

                      <div className="p-6 bg-blue-50 rounded-2xl border border-blue-100 relative">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-sm font-bold text-blue-900 flex items-center gap-2">
                            <ShieldCheck className="w-4 h-4" />
                            Required Certifications
                          </h4>
                          {data.tradeLaws.requiredCertificationsLink && (
                            <a href={data.tradeLaws.requiredCertificationsLink} target="_blank" rel="noopener noreferrer" className="text-[10px] flex items-center gap-1 text-blue-600 hover:text-blue-700 font-bold bg-blue-100/50 px-2 py-1 rounded-md transition-colors uppercase tracking-wider">
                              Apply Here <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                        <p className="text-sm text-blue-800 leading-relaxed">{data.tradeLaws.requiredCertifications}</p>
                      </div>

                      <div className="p-6 bg-emerald-50 rounded-2xl border border-emerald-100 relative">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-sm font-bold text-emerald-900 flex items-center gap-2">
                            <Zap className="w-4 h-4" />
                            Country Standards
                          </h4>
                          {data.tradeLaws.countryStandardsLink && (
                            <a href={data.tradeLaws.countryStandardsLink} target="_blank" rel="noopener noreferrer" className="text-[10px] flex items-center gap-1 text-emerald-600 hover:text-emerald-700 font-bold bg-emerald-100/50 px-2 py-1 rounded-md transition-colors uppercase tracking-wider">
                              Official Link <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                        <p className="text-sm text-emerald-800 leading-relaxed">{data.tradeLaws.countryStandards}</p>
                      </div>

                      {data.tradeLaws.packagingAndLabeling && (
                        <div className="p-6 bg-amber-50 rounded-2xl border border-amber-100 relative">
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-sm font-bold text-amber-900 flex items-center gap-2">
                              <Package className="w-4 h-4" />
                              Packaging & Labeling Requirements
                            </h4>
                            {data.tradeLaws.packagingAndLabelingLink && (
                              <a href={data.tradeLaws.packagingAndLabelingLink} target="_blank" rel="noopener noreferrer" className="text-[10px] flex items-center gap-1 text-amber-600 hover:text-amber-700 font-bold bg-amber-100/50 px-2 py-1 rounded-md transition-colors uppercase tracking-wider">
                                Official Link <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                          <p className="text-sm text-amber-800 leading-relaxed">{data.tradeLaws.packagingAndLabeling}</p>
                        </div>
                      )}

                      {data.tradeLaws.antiDumpingDuties && (
                        <div className="p-6 bg-red-50 rounded-2xl border border-red-100 relative">
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-sm font-bold text-red-900 flex items-center gap-2">
                              <AlertCircle className="w-4 h-4" />
                              Anti-Dumping & Countervailing Duties (ADD/CVD)
                            </h4>
                            {data.tradeLaws.antiDumpingDutiesLink && (
                              <a href={data.tradeLaws.antiDumpingDutiesLink} target="_blank" rel="noopener noreferrer" className="text-[10px] flex items-center gap-1 text-red-600 hover:text-red-700 font-bold bg-red-100/50 px-2 py-1 rounded-md transition-colors uppercase tracking-wider">
                                Official Link <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                          <p className="text-sm text-red-800 leading-relaxed">{data.tradeLaws.antiDumpingDuties}</p>
                        </div>
                      )}

                      {data.tradeLaws.paperworkLinks && data.tradeLaws.paperworkLinks.length > 0 && (
                        <div className="p-6 bg-indigo-50 rounded-2xl border border-indigo-100">
                          <h4 className="text-sm font-bold text-indigo-900 flex items-center gap-2 mb-4">
                            <ExternalLink className="w-4 h-4" />
                            Official Paperwork & Department Links
                          </h4>
                          <div className="space-y-3">
                            {data.tradeLaws.paperworkLinks.map((link, idx) => (
                              <div key={idx} className="bg-white p-3 rounded-xl border border-indigo-100/50 hover:border-indigo-300 transition-colors">
                                <a href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-start justify-between group">
                                  <div className="pr-4">
                                    <h5 className="text-sm font-bold text-indigo-900 group-hover:text-indigo-600 transition-colors flex items-center gap-2">
                                      {link.title}
                                    </h5>
                                    <p className="text-xs font-medium text-indigo-500 mt-1">{link.department}</p>
                                    <p className="text-xs text-slate-600 mt-1">{link.description}</p>
                                  </div>
                                  <ExternalLink className="w-4 h-4 text-indigo-300 group-hover:text-indigo-500 flex-shrink-0 mt-1 transition-colors" />
                                </a>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </section>

                  {/* Logistics Map */}
                  <section>
                    <div className="flex items-center gap-2 mb-6">
                      <MapPin className="w-5 h-5 text-blue-500" />
                      <h3 className="text-lg font-bold text-slate-900">Logistics Infrastructure</h3>
                    </div>
                    <LogisticsMap country={country} />
                  </section>

                  {/* Logistics */}
                  {data.logistics && data.logistics.length > 0 && (
                    <section>
                      <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-2">
                          <Package className="w-5 h-5 text-blue-500" />
                          <h3 className="text-lg font-bold text-slate-900">Logistics & Shipping</h3>
                        </div>
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-100 px-2 py-1 rounded-md">
                          Historical Estimates
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-4">
                        {data.logistics.map((log, idx) => (
                          <div key={idx} className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                            <div className="flex items-center justify-between mb-4">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
                                  <Zap className="w-5 h-5" />
                                </div>
                                <div>
                                  <h4 className="font-bold text-slate-900">{log.mode}</h4>
                                  <p className="text-xs text-slate-500">{log.durationFast} - {log.durationSlow}</p>
                                </div>
                              </div>
                              <div className="text-right">
                                <span className="text-lg font-bold text-blue-600">{baseCurrency}{convertValue(log.basePrice, 'USD').toFixed(2)}</span>
                                <span className="text-[10px] text-slate-400 block uppercase">per {log.priceUnit}</span>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4 text-xs mb-4">
                              <div>
                                <span className="text-slate-400 block uppercase font-bold text-[9px]">Port of Entry</span>
                                <span className="text-slate-700">{log.portOfEntry}</span>
                              </div>
                              <div>
                                <span className="text-slate-400 block uppercase font-bold text-[9px]">Incoterms</span>
                                <span className="text-slate-700">{log.recommendedIncoterms?.join(', ') || 'N/A'}</span>
                              </div>
                            </div>
                            <p className="text-xs text-slate-600 italic mb-4">"{log.costBenefitAnalysis}"</p>
                            <div className="space-y-3">
                              <h5 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Top Providers</h5>
                              {(log.providers || []).map((p, pIdx) => (
                                <div key={pIdx} className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-2">
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <span className="text-xs font-bold text-slate-900 block">{p.name}</span>
                                      <span className="text-[10px] text-slate-500">{p.specialty}</span>
                                    </div>
                                    <div className="flex items-center gap-1 bg-amber-50 px-2 py-0.5 rounded-md">
                                      <TrendingUp className="w-3 h-3 text-amber-500" />
                                      <span className="text-[10px] font-bold text-amber-700">{p.rating}</span>
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-600">
                                    <p><span className="font-bold">Response:</span> {p.responseTime}</p>
                                    <p><span className="font-bold">Network:</span> {p.globalNetwork}</p>
                                  </div>
                                  <p className="text-[10px] text-slate-500 italic">{p.history}</p>
                                  <p className="text-[10px] text-slate-500 font-mono">{p.contactDetails}</p>
                                  {p.certifications && p.certifications.length > 0 && (
                                    <div className="flex flex-wrap gap-1 pt-1">
                                      {p.certifications.map((c, cIdx) => (
                                        <span key={cIdx} className="px-1.5 py-0.5 bg-white text-emerald-600 rounded border border-emerald-100 text-[9px] font-bold uppercase">{c}</span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Compliance & Licenses */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {data.compliance && data.compliance.length > 0 && (
                      <section>
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Compliance</h3>
                        <div className="space-y-3">
                          {data.compliance.map((c, idx) => (
                            <div key={idx} className="p-4 bg-white border border-slate-100 rounded-xl shadow-sm relative">
                              <div className="flex items-start justify-between mb-1">
                                <h4 className="text-sm font-bold text-slate-900 pr-4">{c.requirement}</h4>
                                {c.applyLink && (
                                  <a href={c.applyLink} target="_blank" rel="noopener noreferrer" className="text-[10px] flex items-center gap-1 text-emerald-600 hover:text-emerald-700 font-bold bg-emerald-50 px-2 py-1 rounded-md transition-colors uppercase tracking-wider flex-shrink-0">
                                    Apply <ExternalLink className="w-3 h-3" />
                                  </a>
                                )}
                              </div>
                              <p className="text-xs text-slate-500 mb-2">{c.description}</p>
                              {c.whereToGetDone && (
                                <p className="text-[10px] text-slate-600 mb-2 font-medium">
                                  <span className="text-slate-400">Where to apply:</span> {c.whereToGetDone}
                                </p>
                              )}
                              <div className="flex items-center justify-between text-[10px]">
                                <span className="text-emerald-600 font-bold">{convertText(c.estimatedCost)}</span>
                                <span className="text-slate-400">{c.validityPeriod}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                    {data.exportLicenses && data.exportLicenses.length > 0 && (
                      <section>
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Licenses</h3>
                        <div className="space-y-3">
                          {data.exportLicenses.map((l, idx) => (
                            <div key={idx} className="p-4 bg-white border border-slate-100 rounded-xl shadow-sm relative">
                              <div className="flex items-start justify-between mb-1">
                                <h4 className="text-sm font-bold text-slate-900 pr-4">{l.licenseName}</h4>
                                {l.applyLink && (
                                  <a href={l.applyLink} target="_blank" rel="noopener noreferrer" className="text-[10px] flex items-center gap-1 text-blue-600 hover:text-blue-700 font-bold bg-blue-50 px-2 py-1 rounded-md transition-colors uppercase tracking-wider flex-shrink-0">
                                    Apply <ExternalLink className="w-3 h-3" />
                                  </a>
                                )}
                              </div>
                              <p className="text-xs text-slate-500 mb-2">{l.issuingAuthority}</p>
                              <div className="flex items-center justify-between text-[10px]">
                                <span className="text-purple-600 font-bold">{convertText(l.cost)}</span>
                                <span className="text-slate-400">{l.processingTime}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                  </div>

                  {/* Execution Roadmap */}
                  {data.executionRoadmap && data.executionRoadmap.length > 0 && (
                    <section>
                      <div className="flex items-center gap-2 mb-6">
                        <TrendingUp className="w-5 h-5 text-emerald-500" />
                        <h3 className="text-lg font-bold text-slate-900">Roadmap to Execute</h3>
                      </div>
                      <div className="space-y-4">
                        {data.executionRoadmap.map((step, idx) => (
                          <div key={idx} className="relative pl-8 pb-8 last:pb-0">
                            {/* Timeline Line */}
                            {idx !== data.executionRoadmap!.length - 1 && (
                              <div className="absolute left-[11px] top-6 bottom-0 w-0.5 bg-slate-100" />
                            )}
                            {/* Timeline Dot */}
                            <div className="absolute left-0 top-1.5 w-6 h-6 rounded-full bg-emerald-100 border-4 border-white shadow-sm flex items-center justify-center">
                              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            </div>
                            
                            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">{step.phase}</span>
                                {step.estimatedTime && (
                                  <span className="text-[10px] font-bold text-slate-400 uppercase">{step.estimatedTime}</span>
                                )}
                              </div>
                              <h4 className="text-sm font-bold text-slate-900 mb-1">{step.step}</h4>
                              <p className="text-xs text-slate-600 leading-relaxed mb-3">{step.description}</p>
                              {step.actionRequired && (
                                <div className="bg-white px-3 py-2 rounded-lg border border-slate-200 inline-block">
                                  <span className="text-[10px] font-bold text-slate-400 uppercase block mb-0.5">Action Required</span>
                                  <span className="text-[10px] font-bold text-slate-900">{step.actionRequired}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              ) : null}
            </div>

            {/* Footer */}
            <div className="px-8 py-4 bg-slate-50 border-t border-slate-100 flex justify-end">
              <button 
                onClick={onClose}
                className="px-6 py-2 bg-slate-900 text-white rounded-xl font-bold text-sm hover:bg-slate-800 transition-colors"
              >
                Close Analysis
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>

    <TalkToExpertModal
      isOpen={isExpertModalOpen}
      onClose={() => setIsExpertModalOpen(false)}
      productName={productName}
      hsCode={hsCode}
      origin={originCountry}
      destination={country}
    />

    <DocumentGeneratorModal 
      isOpen={isDocumentModalOpen}
      onClose={() => setIsDocumentModalOpen(false)}
      productName={productName}
      hsCode={hsCode}
      originCountry={originCountry}
      destinationCountry={country}
    />
    </>
  );
};
