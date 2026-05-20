import React, { useState, useEffect } from 'react';
import { User, Mail, Phone, Building2, MapPin, Globe, FileText, Save, ArrowLeft, Loader2, CheckCircle2, AlertCircle, Package } from 'lucide-react';
import { auth, db } from '../firebase';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, getDocFromServer } from 'firebase/firestore';
import { UserProfile } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { CountryAutocomplete } from './CountryAutocomplete';
import { GenericAutocomplete } from './GenericAutocomplete';

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

const COMMON_STATES: Record<string, string[]> = {
  "India": ["Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal"],
  "United States": ["Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming"],
  "United Kingdom": ["England", "Scotland", "Wales", "Northern Ireland"],
  "Canada": ["Alberta", "British Columbia", "Manitoba", "New Brunswick", "Newfoundland and Labrador", "Nova Scotia", "Ontario", "Prince Edward Island", "Quebec", "Saskatchewan"],
  "Australia": ["New South Wales", "Queensland", "South Australia", "Tasmania", "Victoria", "Western Australia"],
  "Germany": ["Baden-Württemberg", "Bavaria", "Berlin", "Brandenburg", "Bremen", "Hamburg", "Hesse", "Lower Saxony", "Mecklenburg-Vorpommern", "North Rhine-Westphalia", "Rhineland-Palatinate", "Saarland", "Saxony", "Saxony-Anhalt", "Schleswig-Holstein", "Thuringia"],
  "France": ["Auvergne-Rhône-Alpes", "Bourgogne-Franche-Comté", "Brittany", "Centre-Val de Loire", "Corsica", "Grand Est", "Hauts-de-France", "Île-de-France", "Normandy", "Nouvelle-Aquitaine", "Occitanie", "Pays de la Loire", "Provence-Alpes-Côte d'Azur"]
};

const COMMON_CITIES: Record<string, string[]> = {
  "India": [
    "Mumbai", "Delhi", "Bangalore", "Hyderabad", "Ahmedabad", "Chennai", "Kolkata", "Surat", "Pune", "Jaipur", 
    "Lucknow", "Kanpur", "Nagpur", "Indore", "Thane", "Bhopal", "Visakhapatnam", "Pimpri-Chinchwad", "Patna", "Vadodara",
    "Ghaziabad", "Ludhiana", "Agra", "Nashik", "Faridabad", "Meerut", "Rajkot", "Kalyan-Dombivli", "Vasai-Virar", "Varanasi",
    "Srinagar", "Aurangabad", "Dhanbad", "Amritsar", "Navi Mumbai", "Allahabad", "Ranchi", "Howrah", "Coimbatore", "Jabalpur",
    "Gwalior", "Vijayawada", "Jodhpur", "Madurai", "Raipur", "Kota", "Guwahati", "Chandigarh", "Solapur", "Hubli-Dharwad"
  ],
  "United States": [
    "New York City", "Los Angeles", "Chicago", "Houston", "Phoenix", "Philadelphia", "San Antonio", "San Diego", "Dallas", "San Jose", 
    "Austin", "Jacksonville", "Fort Worth", "Columbus", "Charlotte", "San Francisco", "Indianapolis", "Seattle", "Denver", "Washington, D.C.",
    "Boston", "El Paso", "Nashville", "Detroit", "Oklahoma City", "Portland", "Las Vegas", "Memphis", "Louisville", "Baltimore",
    "Milwaukee", "Albuquerque", "Tucson", "Fresno", "Sacramento", "Mesa", "Kansas City", "Atlanta", "Long Beach", "Colorado Springs",
    "Raleigh", "Miami", "Virginia Beach", "Omaha", "Oakland", "Minneapolis", "Tulsa", "Arlington", "New Orleans", "Wichita"
  ],
  "United Kingdom": [
    "London", "Birmingham", "Manchester", "Glasgow", "Liverpool", "Leeds", "Sheffield", "Edinburgh", "Bristol", "Leicester",
    "Coventry", "Belfast", "Cardiff", "Nottingham", "Hull", "Newcastle upon Tyne", "Stoke-on-Trent", "Southampton", "Reading", "Derby",
    "Plymouth", "Wolverhampton", "Swansea", "Milton Keynes", "Aberdeen", "Norwich", "Oxford", "Cambridge", "Brighton", "Exeter"
  ],
  "Canada": ["Toronto", "Montreal", "Vancouver", "Calgary", "Edmonton", "Ottawa", "Winnipeg", "Quebec City", "Hamilton", "Kitchener"],
  "Australia": ["Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide", "Gold Coast", "Canberra", "Newcastle", "Wollongong", "Geelong"],
  "Germany": ["Berlin", "Hamburg", "Munich", "Cologne", "Frankfurt", "Stuttgart", "Düsseldorf", "Dortmund", "Essen", "Leipzig"],
  "France": ["Paris", "Marseille", "Lyon", "Toulouse", "Nice", "Nantes", "Strasbourg", "Montpellier", "Bordeaux", "Lille"]
};

interface ProfilePageProps {
  onBack: () => void;
}

export const ProfilePage: React.FC<ProfilePageProps> = ({ onBack }) => {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [formData, setFormData] = useState({
    displayName: '',
    phoneNumber: '',
    country: '',
    state: '',
    city: '',
    pinCode: '',
    completeAddress: '',
    companyName: '',
    companyAddress: '',
    companyWebsite: '',
    companyDescription: '',
    catalogUrl: ''
  });

  useEffect(() => {
    const fetchProfile = async () => {
      if (!auth.currentUser) return;
      
      try {
        // Test connection
        try {
          await getDocFromServer(doc(db, 'test', 'connection'));
        } catch (e) {
          // Ignore connection test errors unless they indicate offline
          if (e instanceof Error && e.message.includes('the client is offline')) {
            console.error("Firebase connection test failed: client is offline");
          }
        }

        const docRef = doc(db, 'users', auth.currentUser.uid);
        let docSnap;
        try {
          docSnap = await getDoc(docRef);
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, `users/${auth.currentUser.uid}`);
          return;
        }
        
        if (docSnap && docSnap.exists()) {
          const data = docSnap.data() as UserProfile;
          setProfile(data);
          setFormData({
            displayName: data.displayName || '',
            phoneNumber: data.phoneNumber || '',
            country: data.country || '',
            state: data.state || '',
            city: data.city || '',
            pinCode: data.pinCode || '',
            completeAddress: data.completeAddress || '',
            companyName: data.companyName || '',
            companyAddress: data.companyAddress || '',
            companyWebsite: data.companyWebsite || '',
            companyDescription: data.companyDescription || '',
            catalogUrl: data.catalogUrl || ''
          });
        } else {
          // Initialize profile if it doesn't exist
          const initialData = {
            uid: auth.currentUser.uid,
            email: auth.currentUser.email || '',
            displayName: auth.currentUser.displayName || '',
            phoneNumber: '',
            country: '',
            state: '',
            city: '',
            pinCode: '',
            completeAddress: '',
            companyName: '',
            companyAddress: '',
            companyWebsite: '',
            companyDescription: '',
            catalogUrl: '',
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
          try {
            await setDoc(docRef, initialData);
          } catch (err) {
            handleFirestoreError(err, OperationType.CREATE, `users/${auth.currentUser.uid}`);
          }
          setProfile(initialData as UserProfile);
          setFormData({
            displayName: initialData.displayName,
            phoneNumber: '',
            country: '',
            state: '',
            city: '',
            pinCode: '',
            completeAddress: '',
            companyName: '',
            companyAddress: '',
            companyWebsite: '',
            companyDescription: '',
            catalogUrl: ''
          });
        }
      } catch (err) {
        console.error('Error fetching profile:', err);
        setError('Failed to load profile. Please check your permissions.');
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser) return;

    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const docRef = doc(db, 'users', auth.currentUser.uid);
      const updateData = {
        ...formData,
        updatedAt: Date.now()
      };
      await updateDoc(docRef, updateData);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${auth.currentUser.uid}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="w-12 h-12 text-emerald-600 animate-spin mb-4" />
        <p className="text-slate-600 font-medium">Loading your profile...</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <button 
        onClick={onBack}
        className="flex items-center gap-2 text-slate-500 hover:text-slate-800 transition-colors mb-8 font-medium"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Dashboard
      </button>

      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">User Profile</h1>
          <p className="text-slate-500">Manage your personal and company information</p>
        </div>
        <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center text-emerald-600">
          <User className="w-8 h-8" />
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Personal Information */}
        <div className="glass-card p-8 rounded-3xl border border-slate-200 shadow-sm">
          <h2 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
            <User className="w-5 h-5 text-emerald-600" />
            Personal Information
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="block text-sm font-bold text-slate-700 uppercase tracking-wider">Full Name</label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                  type="text" 
                  name="displayName"
                  value={formData.displayName}
                  onChange={handleChange}
                  className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:border-emerald-500 focus:ring-0 transition-all"
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-bold text-slate-700 uppercase tracking-wider">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                  type="email" 
                  value={profile?.email}
                  disabled
                  className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-500 cursor-not-allowed"
                />
              </div>
              <p className="text-[10px] text-slate-400 italic">Email cannot be changed as it is linked to your account.</p>
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-bold text-slate-700 uppercase tracking-wider">Phone Number</label>
              <div className="relative">
                <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                  type="tel" 
                  name="phoneNumber"
                  value={formData.phoneNumber}
                  onChange={handleChange}
                  placeholder="+1 (555) 000-0000"
                  className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:border-emerald-500 focus:ring-0 transition-all"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-bold text-slate-700 uppercase tracking-wider">Country</label>
              <CountryAutocomplete 
                value={formData.country}
                onChange={(val) => setFormData(prev => ({ ...prev, country: val, state: '', city: '' }))}
                placeholder="e.g. India"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-bold text-slate-700 uppercase tracking-wider">State</label>
              <GenericAutocomplete 
                value={formData.state}
                onChange={(val) => setFormData(prev => ({ ...prev, state: val, city: '' }))}
                options={COMMON_STATES[formData.country] || []}
                placeholder="e.g. California"
                icon={<MapPin className="w-4 h-4" />}
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-bold text-slate-700 uppercase tracking-wider">City</label>
              <GenericAutocomplete 
                value={formData.city}
                onChange={(val) => setFormData(prev => ({ ...prev, city: val }))}
                options={COMMON_CITIES[formData.country] || []}
                placeholder="e.g. San Francisco"
                icon={<MapPin className="w-4 h-4" />}
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-bold text-slate-700 uppercase tracking-wider">Pin Code</label>
              <div className="relative">
                <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                  type="text" 
                  name="pinCode"
                  value={formData.pinCode}
                  onChange={handleChange}
                  placeholder="e.g. 94105"
                  className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:border-emerald-500 focus:ring-0 transition-all"
                />
              </div>
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="block text-sm font-bold text-slate-700 uppercase tracking-wider">Complete Personal Address</label>
              <div className="relative">
                <MapPin className="absolute left-4 top-4 w-4 h-4 text-slate-400" />
                <textarea 
                  name="completeAddress"
                  value={formData.completeAddress}
                  onChange={handleChange}
                  rows={3}
                  placeholder="Street address, Apartment, Suite, etc."
                  className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:border-emerald-500 focus:ring-0 transition-all resize-none"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Company Information */}
        <div className="glass-card p-8 rounded-3xl border border-slate-200 shadow-sm">
          <h2 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
            <Building2 className="w-5 h-5 text-emerald-600" />
            Company Details
          </h2>
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="block text-sm font-bold text-slate-700 uppercase tracking-wider">Company Name</label>
                <div className="relative">
                  <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input 
                    type="text" 
                    name="companyName"
                    value={formData.companyName}
                    onChange={handleChange}
                    className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:border-emerald-500 focus:ring-0 transition-all"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-bold text-slate-700 uppercase tracking-wider">Website</label>
                <div className="relative">
                  <Globe className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input 
                    type="url" 
                    name="companyWebsite"
                    value={formData.companyWebsite}
                    onChange={handleChange}
                    placeholder="https://example.com"
                    className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:border-emerald-500 focus:ring-0 transition-all"
                  />
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-bold text-slate-700 uppercase tracking-wider">Company Address</label>
              <div className="relative">
                <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                  type="text" 
                  name="companyAddress"
                  value={formData.companyAddress}
                  onChange={handleChange}
                  className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:border-emerald-500 focus:ring-0 transition-all"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-bold text-slate-700 uppercase tracking-wider">Company Description</label>
              <div className="relative">
                <FileText className="absolute left-4 top-4 w-4 h-4 text-slate-400" />
                <textarea 
                  name="companyDescription"
                  value={formData.companyDescription}
                  onChange={handleChange}
                  rows={4}
                  className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:border-emerald-500 focus:ring-0 transition-all resize-none"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Catalog Section */}
        <div className="glass-card p-8 rounded-3xl border border-slate-200 shadow-sm">
          <h2 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
            <Package className="w-5 h-5 text-emerald-600" />
            Product Catalog
          </h2>
          <div className="space-y-2">
            <label className="block text-sm font-bold text-slate-700 uppercase tracking-wider">Catalog URL</label>
            <div className="relative">
              <Globe className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="url" 
                name="catalogUrl"
                value={formData.catalogUrl}
                onChange={handleChange}
                placeholder="Link to your PDF or online catalog"
                className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:border-emerald-500 focus:ring-0 transition-all"
              />
            </div>
            <p className="text-xs text-slate-500">Provide a link to your company's product catalog for easier reference during trade analysis.</p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-4 pt-4">
          {success && (
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-2 text-emerald-600 font-bold"
            >
              <CheckCircle2 className="w-5 h-5" />
              Changes saved successfully!
            </motion.div>
          )}
          {error && (
            <div className="flex items-center gap-2 text-rose-600 font-bold">
              <AlertCircle className="w-5 h-5" />
              {error}
            </div>
          )}
          <button 
            type="button"
            onClick={onBack}
            className="px-8 py-4 rounded-xl font-bold text-slate-600 hover:bg-slate-100 transition-all"
          >
            Cancel
          </button>
          <button 
            type="submit"
            disabled={saving}
            className="bg-emerald-600 text-white px-10 py-4 rounded-xl font-bold flex items-center gap-2 hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/20 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
            Save Profile
          </button>
        </div>
      </form>
    </div>
  );
};
