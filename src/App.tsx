import React, { useState, Component, ErrorInfo, ReactNode, useEffect } from 'react';
import { Globe, Search, ArrowRight, Loader2, MapPin, TrendingUp, AlertTriangle, ShieldCheck, DollarSign, Package, FileText, Zap, RefreshCcw, LogIn, LogOut, Download, AlertCircle, User } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { analyzeProduct, classifyProduct } from './services/gemini';
import { CountryAutocomplete } from './components/CountryAutocomplete';
import { MarketAnalysis, ClassificationResult, ClassificationQuestion } from './types';
import WorldMap from './components/WorldMap';
import { MarketCard } from './components/MarketCard';
import { MarketDetailModal } from './components/MarketDetailModal';
import { GenericDetailModal } from './components/GenericDetailModal';
import { CustomMarketExplorer } from './components/CustomMarketExplorer';
import { ProfilePage } from './components/ProfilePage';
import { Market } from './types';
import { auth, db } from './firebase';
import { signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { doc, setDoc, collection } from 'firebase/firestore';
import { exportToCSV } from './utils/export';

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

import { CurrencySelector } from './components/CurrencySelector';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null
    };
  }

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="max-w-md w-full glass-card p-8 rounded-3xl text-center border border-slate-200 shadow-xl">
            <div className="w-16 h-16 bg-rose-50 rounded-2xl flex items-center justify-center mx-auto mb-6 text-rose-600">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">Something went wrong</h1>
            <p className="text-slate-600 mb-8 leading-relaxed">
              An unexpected error occurred while processing your request. Our team has been notified.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-slate-900 text-white px-6 py-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition-all"
            >
              <RefreshCcw className="w-5 h-5" />
              Reload Application
            </button>
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <div className="mt-8 p-4 bg-slate-100 rounded-xl text-left overflow-auto max-h-40">
                <code className="text-xs text-slate-500 whitespace-pre-wrap">
                  {this.state.error.toString()}
                </code>
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

import { APIProvider } from '@vis.gl/react-google-maps';

import { CurrencyProvider } from './contexts/CurrencyContext';

const API_KEY =
  process.env.GOOGLE_MAPS_PLATFORM_KEY ||
  (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY ||
  (globalThis as any).GOOGLE_MAPS_PLATFORM_KEY ||
  '';
const hasValidKey = Boolean(API_KEY) && API_KEY !== 'YOUR_API_KEY';

export default function App() {
  if (!hasValidKey) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans">
        <div className="max-w-xl w-full glass-card p-10 rounded-3xl text-center border border-slate-200 shadow-2xl">
          <div className="w-20 h-20 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-8 text-blue-600">
            <Globe className="w-10 h-10" />
          </div>
          <h2 className="text-3xl font-bold text-slate-900 mb-4">Google Maps API Key Required</h2>
          <p className="text-slate-600 mb-8 leading-relaxed">
            To enable advanced trade intelligence features and interactive mapping, please provide your Google Maps Platform API key.
          </p>
          
          <div className="space-y-6 text-left bg-white/50 p-6 rounded-2xl border border-slate-100">
            <div>
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-2 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-slate-900 text-white text-[10px] flex items-center justify-center">1</span>
                Get your API Key
              </h3>
              <p className="text-sm text-slate-500">
                Visit the <a href="https://console.cloud.google.com/google/maps-apis/credentials" target="_blank" rel="noopener" className="text-blue-600 hover:underline font-medium">Google Cloud Console</a> to create or retrieve your key.
              </p>
            </div>
            
            <div>
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-2 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-slate-900 text-white text-[10px] flex items-center justify-center">2</span>
                Add to AI Studio Secrets
              </h3>
              <ul className="text-sm text-slate-500 space-y-2">
                <li className="flex items-start gap-2">
                  <div className="mt-1.5 w-1 h-1 rounded-full bg-slate-400 shrink-0" />
                  <span>Open <strong>Settings</strong> (⚙️ gear icon in the top-right corner of the AI Studio interface).</span>
                </li>
                <li className="flex items-start gap-2">
                  <div className="mt-1.5 w-1 h-1 rounded-full bg-slate-400 shrink-0" />
                  <span>Select the <strong>Secrets</strong> tab.</span>
                </li>
                <li className="flex items-start gap-2">
                  <div className="mt-1.5 w-1 h-1 rounded-full bg-slate-400 shrink-0" />
                  <span>Type <code>GOOGLE_MAPS_PLATFORM_KEY</code> as the name and press <strong>Enter</strong>.</span>
                </li>
                <li className="flex items-start gap-2">
                  <div className="mt-1.5 w-1 h-1 rounded-full bg-slate-400 shrink-0" />
                  <span>Paste your API key as the value and press <strong>Enter</strong>.</span>
                </li>
              </ul>
            </div>
          </div>
          
          <p className="mt-8 text-xs text-slate-400 italic">
            The application will automatically rebuild and refresh once the secret is saved.
          </p>
        </div>
      </div>
    );
  }

  return (
    <APIProvider apiKey={API_KEY} version="weekly">
      <ErrorBoundary>
        <CurrencyProvider>
          <AppContent />
        </CurrencyProvider>
      </ErrorBoundary>
    </APIProvider>
  );
}

function AppContent() {
  const [description, setDescription] = useState('');
  const [originCountry, setOriginCountry] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<MarketAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [selectedDestination, setSelectedDestination] = useState<string | undefined>(undefined);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [mapSelectedMarket, setMapSelectedMarket] = useState<{ market: any; type: 'green' | 'yellow' | 'red' | 'origin' | 'neutral' } | null>(null);
  const [isGenericModalOpen, setIsGenericModalOpen] = useState(false);
  const [genericModalData, setGenericModalData] = useState<{ title: string; subtitle?: string; data: any } | null>(null);
  const [activeMarketTab, setActiveMarketTab] = useState<'green' | 'yellow' | 'red'>('green');
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [customAnalyzing, setCustomAnalyzing] = useState(false);
  const [showApiBanner, setShowApiBanner] = useState(true);
  const [apiStatus, setApiStatus] = useState<{ unComtrade: boolean; wto: boolean; mode: string } | null>(null);
  const [view, setView] = useState<'dashboard' | 'profile'>('dashboard');
  const [authError, setAuthError] = useState<string | null>(null);

  // Wizard State
  const [wizardStep, setWizardStep] = useState<'input' | 'clarify' | 'analyzing' | 'result'>('input');
  const [classification, setClassification] = useState<ClassificationResult | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const fetchApiStatus = async () => {
      try {
        const response = await fetch('/api/trade/status');
        if (response.ok) {
          const data = await response.json();
          setApiStatus(data);
        }
      } catch (err) {
        console.error('Failed to fetch API status:', err);
      }
    };
    fetchApiStatus();
  }, []);

  const handleLogin = async () => {
    setAuthError(null);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      console.error('Login error:', err);
      const code = err?.code || 'unknown';
      setAuthError(`${code}: ${err?.message || 'Sign-in failed'}`);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  const handleViewDetails = React.useCallback((market: Market) => {
    console.log('Viewing details for:', market.country);
    setSelectedMarket(market);
    setSelectedDestination(market.country);
    setIsModalOpen(true);
  }, []);

  const handleSelectFromMap = (market: any, type: 'green' | 'yellow' | 'red' | 'origin' | 'neutral', isFullAnalysis?: boolean) => {
    setMapSelectedMarket({ market, type });
    setSelectedDestination(market.country);
    if (isFullAnalysis && type !== 'origin' && type !== 'neutral') {
      setSelectedMarket(market);
      setIsModalOpen(true);
    }
  };

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim() || !originCountry.trim()) return;

    setLoading(true);
    setError(null);
    setWizardStep('analyzing');
    
    try {
      // Step 1: Classification Wizard
      const classResult = await classifyProduct(description);
      setClassification(classResult);

      if (classResult.isAmbiguous) {
        setWizardStep('clarify');
        setLoading(false);
        return;
      }

      // Step 2: Full Analysis
      const data = await analyzeProduct(description, originCountry);
      setResult(data);
      setWizardStep('result');
    } catch (err: any) {
      console.error(err);
      let errorMessage = err.message || 'Analysis failed. Please try again.';
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
      setWizardStep('input');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProduct = async () => {
    if (!user || !result) {
      alert("Please log in to save products to your catalog.");
      return;
    }
    
    const path = `users/${user.uid}/products`;
    try {
      const productRef = doc(collection(db, 'users', user.uid, 'products'));
      await setDoc(productRef, {
        productName: result.productName,
        hsCode: result.hsCode,
        originCountry,
        description,
        savedAt: new Date().toISOString(),
        greenMarkets: result.greenMarkets.map(m => m.country),
        yellowMarkets: result.yellowMarkets.map(m => m.country),
        redMarkets: result.redMarkets.map(m => m.country),
      });
      alert("Product saved to your catalog successfully!");
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  };

  const handleClarifySubmit = async () => {
    if (!classification) return;
    
    setLoading(true);
    setWizardStep('analyzing');
    
    try {
      // Step 1: Refine Classification with answers
      const refinedClass = await classifyProduct(description, answers);
      setClassification(refinedClass);

      // Step 2: Full Analysis with refined HS code
      const refinedDescription = `${description}. Details: ${Object.entries(answers).map(([id, ans]) => {
        const q = classification.clarifyingQuestions?.find(q => q.id === id);
        return `${q?.question || 'Detail'}: ${ans}`;
      }).join(', ')}`;

      const data = await analyzeProduct(refinedDescription, originCountry);
      // Ensure we use the refined HS code from the classification step
      data.hsCode = refinedClass.hsCode;
      
      setResult(data);
      setWizardStep('result');
    } catch (err: any) {
      console.error(err);
      let errorMessage = err.message || 'Analysis failed. Please try again.';
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
      setWizardStep('input');
    } finally {
      setLoading(false);
    }
  };

  const handleCustomCountrySelect = async (country: string) => {
    if (!result || !originCountry) return;
    
    setCustomAnalyzing(true);
    try {
      // We don't need to fetch here because MarketDetailModal handles the fetching
      // based on the props passed to it. We just need to set the selected market.
      setSelectedMarket({ country, detailId: `custom-${country}` });
      setSelectedDestination(country);
      setIsModalOpen(true);
    } catch (err) {
      console.error('Error selecting custom country:', err);
    } finally {
      setCustomAnalyzing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center">
                <Globe className="text-white w-5 h-5" />
              </div>
              <span className="font-bold text-xl tracking-tight text-slate-900">GlobalTrade <span className="text-emerald-600">Intelligence</span></span>
            </div>
            
            <div className="flex items-center gap-4">
              {!authLoading && (
                user ? (
                  <div className="flex items-center gap-4">
                    <CurrencySelector />
                    <span className="text-sm font-medium text-slate-600 hidden sm:block">{user.email}</span>
                    <button 
                      onClick={() => setView('profile')}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                    >
                      <User className="w-4 h-4" />
                      Profile
                    </button>
                    <button onClick={handleLogout} className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors">
                      <LogOut className="w-4 h-4" />
                      Sign Out
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-4">
                    <CurrencySelector />
                    <button onClick={handleLogin} className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors shadow-sm">
                      <LogIn className="w-4 h-4" />
                      Sign In
                    </button>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {view === 'profile' ? (
          <ProfilePage onBack={() => setView('dashboard')} />
        ) : (
          <>
            {user && showApiBanner && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className={`mb-8 p-4 border rounded-2xl flex items-center justify-between gap-4 shadow-sm ${
              apiStatus?.mode === 'authoritative' ? 'bg-emerald-50 border-emerald-100' : 'bg-blue-50 border-blue-100'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-md ${
                apiStatus?.mode === 'authoritative' ? 'bg-emerald-600' : 'bg-blue-600'
              }`}>
                {apiStatus?.mode === 'authoritative' ? <ShieldCheck className="w-5 h-5" /> : <Zap className="w-5 h-5" />}
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">
                  Authoritative Data Mode: <span className={apiStatus?.mode === 'authoritative' ? 'text-emerald-600' : 'text-blue-600'}>
                    {apiStatus?.mode === 'authoritative' ? 'ACTIVE' : 'Search-Augmented'}
                  </span>
                </h4>
                <p className="text-xs text-slate-500">
                  {apiStatus?.mode === 'authoritative' 
                    ? 'Official UN Comtrade & WTO data streams are now live. Your reports are grounded in authoritative facts.' 
                    : `Missing Keys: ${[!apiStatus?.unComtrade && 'UN_COMTRADE_API_KEY', !apiStatus?.wto && 'WTO_API_KEY'].filter(Boolean).join(', ')}. Please add them in the Secrets panel.`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setShowApiBanner(false)}
                className="p-2 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <RefreshCcw className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
          </>
        )}
        {authLoading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="w-12 h-12 text-emerald-600 animate-spin mb-4" />
            <p className="text-slate-600 font-medium">Loading...</p>
          </div>
        ) : !user ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            {showApiBanner && (
              <motion.div 
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className={`mb-12 p-4 border rounded-2xl flex items-center justify-between gap-4 shadow-sm max-w-2xl w-full mx-auto ${
                  apiStatus?.mode === 'authoritative' ? 'bg-emerald-50 border-emerald-100' : 'bg-blue-50 border-blue-100'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-md ${
                    apiStatus?.mode === 'authoritative' ? 'bg-emerald-600' : 'bg-blue-600'
                  }`}>
                    {apiStatus?.mode === 'authoritative' ? <ShieldCheck className="w-5 h-5" /> : <Zap className="w-5 h-5" />}
                  </div>
                  <div className="text-left">
                    <h4 className="text-sm font-bold text-slate-900">
                      Authoritative Data Mode: <span className={apiStatus?.mode === 'authoritative' ? 'text-emerald-600' : 'text-blue-600'}>
                        {apiStatus?.mode === 'authoritative' ? 'ACTIVE' : 'Search-Augmented'}
                      </span>
                    </h4>
                    <p className="text-xs text-slate-500">
                      {apiStatus?.mode === 'authoritative' 
                        ? 'Official UN Comtrade & WTO data streams are now live.' 
                        : `Missing Keys: ${[!apiStatus?.unComtrade && 'UN_COMTRADE_API_KEY', !apiStatus?.wto && 'WTO_API_KEY'].filter(Boolean).join(', ')}.`}
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowApiBanner(false)}
                  className="p-2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <RefreshCcw className="w-4 h-4" />
                </button>
              </motion.div>
            )}
            <div className="w-20 h-20 bg-emerald-100 rounded-3xl flex items-center justify-center mb-6">
              <ShieldCheck className="w-10 h-10 text-emerald-600" />
            </div>
            <h2 className="text-3xl font-bold text-slate-900 mb-4">Authentication Required</h2>
            <p className="text-slate-600 max-w-md mx-auto mb-8">
              Please sign in to access the Global Trade Intelligence Engine and analyze export markets.
            </p>
            <button onClick={handleLogin} className="bg-emerald-600 text-white px-8 py-4 rounded-xl font-bold flex items-center gap-2 hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/20">
              <LogIn className="w-5 h-5" />
              Sign In with Google
            </button>
            {authError && (
              <p className="mt-4 text-sm text-red-600 max-w-md mx-auto break-words font-mono">
                {authError}
              </p>
            )}
          </div>
        ) : (
          <AnimatePresence mode="wait">
            {wizardStep === 'input' && (
              <motion.div key="input" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
                <div className="text-center mb-12">
                  <h1 className="text-4xl sm:text-5xl font-bold text-slate-900 mb-4 tracking-tight">
                    Global Trade <span className="gradient-text">Intelligence Engine</span>
                  </h1>
                  <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                    Analyze global markets, extract trade laws, and simulate export costs.
                  </p>
                </div>

                <div className="max-w-3xl mx-auto mb-16">
                  <form onSubmit={handleAnalyze} className="space-y-4">
                    <div className="glass-card p-6 rounded-2xl shadow-sm border border-slate-200">
                      <div className="mb-4">
                        <label className="block text-sm font-bold text-slate-700 mb-2 uppercase tracking-wider">Origin Country</label>
                        <CountryAutocomplete 
                          value={originCountry} 
                          onChange={setOriginCountry} 
                          placeholder="e.g., India, Vietnam, Germany..." 
                        />
                      </div>
                      <div className="relative group">
                        <label className="block text-sm font-bold text-slate-700 mb-2 uppercase tracking-wider">Product Description</label>
                        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe your product (e.g., Eco-friendly bamboo toothbrushes)..." className="w-full h-32 px-6 py-4 bg-white border border-slate-200 rounded-xl focus:border-emerald-500 focus:ring-0 transition-all text-lg resize-none group-hover:border-slate-300" required />
                        <button type="submit" disabled={loading} className="mt-4 w-full bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-4 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-600/20">
                          {loading ? <><Loader2 className="w-5 h-5 animate-spin" /> Classifying Product...</> : <><Search className="w-5 h-5" /> Analyze Global Markets</>}
                        </button>
                      </div>
                    </div>
                  </form>
                  {error && <p className="mt-4 text-rose-600 text-center text-sm font-medium">{error}</p>}
                </div>
              </motion.div>
            )}

            {wizardStep === 'clarify' && classification && (
              <motion.div key="clarify" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="max-w-2xl mx-auto py-12">
                <div className="glass-card p-8 rounded-3xl border border-emerald-100 shadow-xl">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-12 h-12 bg-emerald-100 rounded-2xl flex items-center justify-center text-emerald-600">
                      <Zap className="w-6 h-6" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900">Refine Classification</h2>
                      <p className="text-slate-500 text-sm">To provide 100% accurate tariff data, we need a few more details.</p>
                    </div>
                  </div>

                  <div className="space-y-6 mb-8">
                    {classification.clarifyingQuestions.map((q) => (
                      <div key={q.id} className="space-y-3">
                        <label className="block font-bold text-slate-800">{q.question}</label>
                        {q.options ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {q.options.map(opt => (
                              <button
                                key={opt}
                                onClick={() => setAnswers(prev => ({ ...prev, [q.id]: opt }))}
                                className={`px-4 py-3 rounded-xl border text-left transition-all font-medium ${answers[q.id] === opt ? 'bg-emerald-600 border-emerald-600 text-white shadow-md' : 'bg-white border-slate-200 text-slate-600 hover:border-emerald-300'}`}
                              >
                                {opt}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <input
                            type="text"
                            value={answers[q.id] || ''}
                            onChange={(e) => setAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-emerald-500 focus:ring-0"
                            placeholder="Your answer..."
                          />
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-4">
                    <button onClick={() => setWizardStep('input')} className="flex-1 px-6 py-4 rounded-xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-all">
                      Back
                    </button>
                    <button
                      onClick={handleClarifySubmit}
                      disabled={Object.keys(answers).length < classification.clarifyingQuestions.length || loading}
                      className="flex-[2] bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50 shadow-lg shadow-emerald-600/20"
                    >
                      {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Zap className="w-5 h-5" /> Complete Analysis</>}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {wizardStep === 'analyzing' && (
              <motion.div key="analyzing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center py-32">
                <div className="relative mb-8">
                  <div className="w-24 h-24 border-4 border-emerald-100 border-t-emerald-600 rounded-full animate-spin"></div>
                  <Globe className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-emerald-600 w-10 h-10" />
                </div>
                <h2 className="text-2xl font-bold text-slate-900 mb-2">Deep Market Analysis</h2>
                <p className="text-slate-500 font-medium animate-pulse">Consulting global trade databases and regulatory frameworks...</p>
              </motion.div>
            )}

            {wizardStep === 'result' && result && (
              <motion.div key="result" initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} className="space-y-12">
                <div className="flex items-center justify-between mb-4">
                  <button onClick={() => setWizardStep('input')} className="flex items-center gap-2 text-slate-500 hover:text-slate-800 font-bold transition-colors">
                    <RefreshCcw className="w-4 h-4" /> New Analysis
                  </button>
                </div>
                
                <div className="glass-card p-8 rounded-3xl">
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-6">
                    <div>
                      <div className="flex items-center gap-2 text-emerald-600 font-semibold text-sm uppercase tracking-wider mb-2"><Search className="w-4 h-4" /> Product Classification</div>
                      <h2 className="text-3xl font-bold text-slate-900">{result.productName}</h2>
                    </div>
                    <div className="flex items-center gap-4">
                      <button
                        onClick={handleSaveProduct}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 border border-blue-600 rounded-xl text-sm font-bold text-white hover:bg-blue-700 transition-all shadow-sm"
                      >
                        <Package className="w-4 h-4" />
                        Save to Catalog
                      </button>
                      <button
                        onClick={() => result && exportToCSV(result)}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 transition-all shadow-sm"
                      >
                        <Download className="w-4 h-4" />
                        Export Data
                      </button>
                      <div className="bg-slate-100 px-4 py-2 rounded-xl border border-slate-200 flex items-center gap-4">
                        <div><span className="text-xs font-bold text-slate-500 uppercase block">HS Code</span><span className="font-mono font-bold text-slate-900">{result.hsCode}</span></div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="max-w-3xl mx-auto">
                  <CustomMarketExplorer 
                    onSelectCountry={handleCustomCountrySelect}
                    isAnalyzing={customAnalyzing}
                  />
                </div>

                <WorldMap 
                  greenMarkets={result.greenMarkets} 
                  yellowMarkets={result.yellowMarkets} 
                  redMarkets={result.redMarkets} 
                  originCountry={originCountry} 
                  onSelectCountry={handleSelectFromMap}
                  isAnalyzing={customAnalyzing}
                  activeDestination={selectedDestination}
                />

              <AnimatePresence>
                {mapSelectedMarket && mapSelectedMarket.type !== 'origin' && mapSelectedMarket.type !== 'neutral' && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mb-12"
                  >
                    <div className="flex items-center gap-2 mb-4">
                      <MapPin className="w-5 h-5 text-emerald-600" />
                      <h3 className="text-lg font-bold text-slate-900">Selected Market from Map</h3>
                    </div>
                    <div className="max-w-md">
                      <MarketCard 
                        market={mapSelectedMarket.market} 
                        type={mapSelectedMarket.type as any} 
                        index={0} 
                        onViewDetails={handleViewDetails} 
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Market Explorer Tabs */}
              <div className="mt-16">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
                  <div>
                    <h2 className="text-3xl font-bold text-slate-900 tracking-tight">Market Explorer</h2>
                    <p className="text-slate-500 mt-1">Strategic breakdown of global opportunities and risks.</p>
                  </div>
                  
                  <div className="flex p-1 bg-slate-100 rounded-2xl w-fit">
                    <button
                      onClick={() => setActiveMarketTab('green')}
                      className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2 ${
                        activeMarketTab === 'green' 
                          ? 'bg-white text-emerald-600 shadow-sm' 
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      <TrendingUp className="w-4 h-4" />
                      Green
                      <span className="ml-1 px-1.5 py-0.5 bg-emerald-50 text-emerald-600 rounded-md text-[10px]">
                        {result.greenMarkets.length}
                      </span>
                    </button>
                    <button
                      onClick={() => setActiveMarketTab('yellow')}
                      className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2 ${
                        activeMarketTab === 'yellow' 
                          ? 'bg-white text-amber-600 shadow-sm' 
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      <ShieldCheck className="w-4 h-4" />
                      Yellow
                      <span className="ml-1 px-1.5 py-0.5 bg-amber-50 text-amber-600 rounded-md text-[10px]">
                        {result.yellowMarkets.length}
                      </span>
                    </button>
                    <button
                      onClick={() => setActiveMarketTab('red')}
                      className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2 ${
                        activeMarketTab === 'red' 
                          ? 'bg-white text-rose-600 shadow-sm' 
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      <AlertTriangle className="w-4 h-4" />
                      Red
                      <span className="ml-1 px-1.5 py-0.5 bg-rose-50 text-rose-600 rounded-md text-[10px]">
                        {result.redMarkets.length}
                      </span>
                    </button>
                  </div>
                </div>

                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeMarketTab}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                  >
                    {activeMarketTab === 'green' && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {result.greenMarkets?.map((market, idx) => (
                          <MarketCard key={`green-${market.country}-${idx}`} market={market} type="green" index={idx} onViewDetails={handleViewDetails} />
                        ))}
                      </div>
                    )}
                    {activeMarketTab === 'yellow' && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {result.yellowMarkets?.map((market, idx) => (
                          <MarketCard key={`yellow-${market.country}-${idx}`} market={market} type="yellow" index={idx} onViewDetails={handleViewDetails} />
                        ))}
                      </div>
                    )}
                    {activeMarketTab === 'red' && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {result.redMarkets?.map((market, idx) => (
                          <MarketCard key={`red-${market.country}-${idx}`} market={market} type="red" index={idx} onViewDetails={handleViewDetails} />
                        ))}
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* Strategic Advice */}
              <section className="mt-16 glass-card p-8 rounded-3xl border border-emerald-100 bg-emerald-50/30">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-100 flex items-center justify-center shadow-sm">
                    <TrendingUp className="w-6 h-6 text-emerald-600" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Strategic Advice</h2>
                    <p className="text-sm text-slate-500 font-medium">Difficulty Score: <span className="text-emerald-600 font-bold">{result.difficultyScore}/10</span></p>
                  </div>
                </div>
                <p className="text-slate-700 leading-relaxed font-medium">
                  {result.strategicAdvice}
                </p>
              </section>

              {/* AI Disclaimer */}
              <div className="mt-12 p-6 bg-slate-100 rounded-2xl border border-slate-200 flex items-start gap-4">
                <AlertCircle className="w-6 h-6 text-slate-400 mt-1 flex-shrink-0" />
                <div>
                  <h4 className="text-sm font-bold text-slate-900 mb-1">AI-Generated Intelligence Disclaimer</h4>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    The data provided by GlobalTrade Intelligence is generated by artificial intelligence and is intended for informational and preliminary research purposes only. 
                    While we strive for accuracy, trade laws, tariffs, and market conditions change rapidly. 
                    <strong> This information does not constitute legal, financial, or professional trade advice.</strong> 
                    Always verify critical data with official government sources, customs brokers, or legal counsel before making significant business decisions.
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        )}
      </main>

      <footer className="bg-white border-t border-slate-200 py-12 mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-8">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-slate-200 rounded flex items-center justify-center">
                <Globe className="text-slate-400 w-4 h-4" />
              </div>
              <span className="font-bold text-slate-900">GlobalTrade Intelligence</span>
            </div>
            <div className="flex items-center gap-8 text-sm font-medium text-slate-500">
              <a href="#" className="hover:text-slate-900 transition-colors">Terms of Service</a>
              <a href="#" className="hover:text-slate-900 transition-colors">Privacy Policy</a>
              <a href="#" className="hover:text-slate-900 transition-colors">Contact Support</a>
            </div>
            <p className="text-xs text-slate-400">© 2026 GlobalTrade Intelligence. All rights reserved.</p>
          </div>
        </div>
      </footer>

      <MarketDetailModal 
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedDestination(undefined);
        }}
        detailId={selectedMarket?.detailId || ''}
        country={selectedMarket?.country || ''}
        productName={result?.productName || ''}
        hsCode={result?.hsCode || ''}
        originCountry={originCountry}
      />

      <GenericDetailModal 
        isOpen={isGenericModalOpen}
        onClose={() => setIsGenericModalOpen(false)}
        title={genericModalData?.title || ''}
        subtitle={genericModalData?.subtitle}
        data={genericModalData?.data}
      />
    </div>
  );
}
