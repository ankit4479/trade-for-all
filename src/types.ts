export interface TradeLaws {
  importRegulations: string;
  importRegulationsLink?: string;
  exportRegulations: string;
  exportRegulationsLink?: string;
  customsDocumentation: string;
  customsDocumentationLink?: string;
  prohibitionsAndRestrictions: string;
  prohibitionsAndRestrictionsLink?: string;
  requiredCertifications: string;
  requiredCertificationsLink?: string;
  countryStandards: string;
  countryStandardsLink?: string;
  packagingAndLabeling?: string;
  packagingAndLabelingLink?: string;
  antiDumpingDuties?: string;
  antiDumpingDutiesLink?: string;
  paperworkLinks?: Array<{
    title: string;
    department: string;
    url: string;
    description: string;
  }>;
  confidenceScore?: number;
  sourceUrl?: string;
}

export interface SimulationParams {
  dutyRate: number;
  taxRate: number;
  logisticsCostPerUnit: number;
  unitName: string;
  currency: string;
  paperwork: string;
  confidenceScore?: number;
  sourceUrl?: string;
}

export interface Market {
  country: string;
  why?: string;
  reason?: string;
  marketInsight?: string;
  detailId?: string;
  simulationParams?: SimulationParams;
  tradeLaws?: TradeLaws;
}

export interface GreenMarket extends Market {
  demand?: string;
  barriers?: string;
  growthInsight?: string;
  marketEntryStrategy?: string;
  localCompetitionAnalysis?: string;
  consumerBehaviorInsights?: string;
  ftaDetails?: {
    name: string;
    benefits: string[];
    tariffReduction: string;
    customsStreamlining: string;
    rulesOfOrigin: string;
  };
}

export interface YellowMarket extends Market {
  potential?: string;
  keyChallenges?: string[];
  mitigationStrategies?: string[];
  marketEntryTimeline?: string;
}

export interface RedMarket extends Market {
  reason: string;
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
}

export interface TradePulse {
  headlines: Array<{ title: string; url: string; source: string; date: string; summary: string }>;
  riskLevel: 'Low' | 'Medium' | 'High' | 'Critical';
  riskSummary: string;
  lastChecked: string;
}

export interface ClassificationQuestion {
  id: string;
  question: string;
  options?: string[];
}

export interface ClassificationResult {
  hsCode: string;
  productName: string;
  isAmbiguous: boolean;
  clarifyingQuestions: ClassificationQuestion[];
  confidenceScore: number;
}

export interface MarketAnalysis {
  productName: string;
  hsCode: string;
  greenMarkets: GreenMarket[];
  yellowMarkets: YellowMarket[];
  redMarkets: RedMarket[];
  difficultyScore: number;
  strategicAdvice: string;
  tradePulse?: TradePulse; // Global pulse or specific to origin
}

export interface DetailedMarketInfo {
  country: string;
  marketInsight: string;
  simulationParams: SimulationParams;
  tradeLaws: TradeLaws;
  compliance: Array<{ 
    requirement: string; 
    description: string; 
    whereToGetDone: string;
    applyLink?: string;
    estimatedCost: string;
    validityPeriod: string;
    legalBasis: string;
    stepByStepProcess: string[];
  }>;
  exportLicenses: Array<{ 
    market: string; 
    licenseName: string; 
    issuingAuthority: string; 
    howToApply: string; 
    applyLink?: string;
    processingTime: string; 
    cost: string;
    requiredDocuments: string[];
    renewalProcess: string;
  }>;
  taxes: Array<{ market: string; exportTax: string; importDuty: string; vatOrGst: string; otherFees: string; totalEstimate: string; notes: string; }>;
  logistics: Array<{
    mode: "Sea" | "Air" | "Rail" | "Road";
    durationFast: string;
    durationSlow: string;
    estimatedPrice: string;
    basePrice: number;
    priceUnit: "kg" | "m3" | "container" | "unit";
    portOfEntry: string;
    recommendedIncoterms: string[];
    costBenefitAnalysis: string;
    riskAssessment: string;
    environmentalImpact: string;
    providers: Array<{ 
      name: string; 
      history: string; 
      specialty: string; 
      rating: number; 
      responseTime: string; 
      certifications: string[];
      globalNetwork: string;
      contactDetails: string;
    }>;
  }>;
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
  b2bChannels?: {
    tradeShows: Array<{ name: string; link: string }>;
    platforms: Array<{ name: string; link: string }>;
    distributorMargins: Array<{ name: string; link: string; margin: string }>;
  };
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  phoneNumber: string;
  country: string;
  state: string;
  city: string;
  pinCode: string;
  completeAddress: string;
  companyName: string;
  companyAddress: string;
  companyWebsite: string;
  companyDescription: string;
  catalogUrl?: string;
  createdAt: number;
  updatedAt: number;
}
