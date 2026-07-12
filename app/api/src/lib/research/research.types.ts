export interface CompanySnapshot {
  name: string;
  domain: string | null;
  industry: string | null;
  employeeCount: number | null;
  revenueBand: string | null;
  businessModel: "SaaS" | "Services" | "Marketplace" | "Other" | null;
  valueProposition: string;
  targetCustomer: string;
  techStack: string[];
  recentNews: Array<{
    headline: string;
    url: string;
    publishedAt: string | null;
    relevance: "HIGH" | "MEDIUM" | "LOW";
    relevanceReason: string;
  }>;
  hiringSignals: Array<{
    role: string;
    signalValue: string;
    confidence: number;
    explanation: string;
  }>;
  fundingEvents: Array<{
    description: string;
    amount: string | null;
    date: string | null;
    source: string | null;
  }>;
}

export interface CompetitiveContext {
  competitorSignalDetected: boolean;
  competitorProducts: string[];
  displacementAngle: string | null;
  complementaryAngle: string | null;
  similarWins: Array<{
    signalType: string;
    signalValue: string;
    replyIntent: string;
    pipelineStageAtCapture: string | null;
    subjectPattern: string;
  }>;
  winRateForSignalType: number | null;
}

export interface ICPAlignment {
  overallFitScore: number;
  breakdown: {
    icpMatch: number;
    intentStrength: number;
    fundingSignals: number;
    hiringVelocity: number;
    techFit: number;
    recency: number;
  };
  fitNarrative: string;
  gapNarrative: string | null;
  recommendedAction: "HIGH_PRIORITY" | "STANDARD" | "NURTURE" | "DISQUALIFY";
  evidenceTriggers: string[];
  contactFitNote: string | null;
}

export interface OutreachAngle {
  primaryAngle: string;
  angleRationale: string;
  talkTracks: Array<{
    trigger: string;
    hook: string;
    value: string;
    cta: string;
  }>;
  subjectLineVariants: string[];
  openingLineSuggestion: string;
  warningsAndAvoid: string[];
}

export interface ResearchReport {
  id: string;
  leadId: string;
  status: "PENDING" | "RUNNING" | "COMPLETE" | "FAILED" | "STALE" | "CANCELLED";
  errorMessage?: string | null;
  companySnapshot: CompanySnapshot | null;
  competitiveContext: CompetitiveContext | null;
  icpAlignment: ICPAlignment | null;
  outreachAngle: OutreachAngle | null;
  newSignalsFound: string[];
  startedAt: string;
  completedAt: string | null;
  expiresAt: string | null;
}

export type ResearchStreamEvent =
  | { type: "status"; data: { status: ResearchReport["status"] } }
  | { type: "section"; data: { section: keyof ResearchReport; payload: unknown } }
  | { type: "signal"; data: { signalType: string; value: string; confidence: number; explanation: string } }
  | { type: "error"; data: { message: string } }
  | { type: "complete"; data: { reportId: string; completedAt: string } }
  | { type: "section_failed"; data: { section: string; message: string } };
