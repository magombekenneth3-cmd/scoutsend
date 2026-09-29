/**
 * Production-Grade CRO Intelligence Engine Service
 *
 * Core Law: LLMs reason, diagnose, and propose.
 * Deterministic services verify, calculate, measure, and enforce.
 */

export type FindingClassification = "OBSERVED" | "INFERRED" | "HYPOTHESIS";

export type ChangeType =
  | "COPY"
  | "LAYOUT"
  | "CTA"
  | "COMPONENT"
  | "FLOW"
  | "TRUST"
  | "ONBOARDING";

export type DomainStatus =
  | "VERIFIED"
  | "PROPAGATING"
  | "MISSING"
  | "INCORRECT"
  | "UNAVAILABLE";

export type CROFailureMode =
  | "VALUE_CLARITY"
  | "TRUST"
  | "EXPECTATION_MISMATCH"
  | "COGNITIVE_LOAD"
  | "FRICTION"
  | "MOTIVATION"
  | "CTA"
  | "ERROR_RECOVERY"
  | "SOCIAL_PROOF"
  | "PERCEIVED_RISK";

// ─── 0. Conversion Evidence Package Schema ────────────────────────────────────

export interface ICPProfile {
  targetCustomer: string;
  companySize: string;
  primaryPain: string;
  currentAlternatives: string[];
  desiredOutcomes: string[];
  topObjections: string[];
}

export interface CROInteractionMetric {
  route: string;
  element: string;
  impressions: number;
  clicks: number;
  successfulActions: number;
  abandonmentAfterInteraction: number;
  rageClicks?: number;
  deadClicks?: number;
}

export interface TimeToValueMetrics {
  signupToMailboxConnectedMinutes: number;
  signupToLeadsImportedMinutes: number;
  signupToCampaignCreatedMinutes: number;
  signupToFirstCampaignLaunchedMinutes: number;
  signupToFirstPositiveReplyHours: number;
}

export interface FunnelMetrics {
  landingVisitors: number;
  signupsCompleted: number;
  mailboxesConnected: number;
  domainsVerified: number;
  firstCampaignLaunched: number;
  paidUpgrades: number;
  rates: {
    visitorToSignup: number;
    signupToActivation: number;
    activationToPaid: number;
    overallVisitorToPaid: number;
  };
  screenDropOffs: Array<{
    route: string;
    entered: number;
    completed: number;
    dropOffRate: number;
  }>;
  interactionMetrics?: CROInteractionMetric[];
  timeToValue?: TimeToValueMetrics;
}

export interface BusinessConstraints {
  immutable: string[];
  mutable: string[];
}

export interface CROEvidence {
  id: string;
  type:
    | "SCREENSHOT"
    | "DOM"
    | "SOURCE_CODE"
    | "ANALYTICS"
    | "USER_RESEARCH"
    | "SUPPORT_TICKET"
    | "EXPERIMENT";
  reference: string;
  observation: string;
  route?: string;
  capturedAt: Date;
  metadata?: Record<string, unknown>;
}

export interface CROEvidencePackage {
  auditId: string;
  timestamp: Date;
  productName: string;
  icp: ICPProfile;
  funnel: FunnelMetrics;
  constraints: BusinessConstraints;
  evidence: CROEvidence[];
  routes: Array<{
    path: string;
    stateDescription: string;
    screenshotPath?: string;
    sourceFilePath: string;
  }>;
}

// ─── 1. Split Confidence Data Model ──────────────────────────────────────────

export interface CROConfidence {
  existence: number; // 0.0 - 1.0 (evidence that problem exists)
  causal: number;    // 0.0 - 1.0 (evidence that fixing it improves target conversion)
}

export interface CROFindingInput {
  id: string;
  stage: "visitor_to_signup" | "signup_to_activation" | "activation_to_value" | "value_to_paid" | "retention";
  classification: FindingClassification;
  failureMode: CROFailureMode;
  location: {
    route: string;
    componentName?: string;
    domSelector?: string;
  };
  evidenceIds: string[];
  problem: string;
  psychologicalMechanism: string;
  expectedBehaviorChange: string;
  exposureRate: number; // 0.0 - 1.0 (proportion of eligible cohort exposed)
  impact: number;       // 1 - 10 (LLM proposal)
  effort: number;       // 1 - 5  (LLM proposal)
  risk: number;         // 1 - 3  (LLM proposal)
  causalConfidenceInput?: number;
  confidenceInputs: {
    hasDirectDomEvidence: boolean;
    hasAnalyticsEventData: boolean;
    hasMultipleOccurrences: boolean;
    hasUserResearchFeedback: boolean;
    hasHistoricalExperimentData: boolean;
  };
}

export interface CalculatedCROFinding extends Omit<CROFindingInput, "confidenceInputs"> {
  confidence: CROConfidence;
  evidenceStrength: number;
  scoring: {
    impact: number;
    evidenceStrength: number;
    effort: number;
    risk: number;
    priorityScore: number;
  };
}

// ─── 2. Design Intervention Contract (Contract #3) ───────────────────────────

export interface CROIntervention {
  id: string;
  findingId: string;
  changeType: ChangeType;
  currentExperience: string;
  proposedExperience: string;
  rationale: string;
  expectedMechanism: string[];
  implementationNotes: string[];
}

// ─── 3. Structured Challenger Contract ───────────────────────────────────────

export interface CROChallenge {
  findingId: string;
  challenged: boolean;
  objection: string;
  evidenceRequired?: string[];
  riskIdentified?: string;
  recommendationStatus: "ACCEPT" | "REVISE" | "REJECT";
}

// ─── 4. Complete Persistent Experiment Spec (Contract #4) ────────────────────

export interface CROExperimentSpec {
  id: string;
  interventionId: string;
  findingId: string;
  hypothesisId: string;
  statement: string;
  population: string;
  controlVariant: {
    description: string;
  };
  treatmentVariant: {
    description: string;
  };
  primaryMetric: string;
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  minRequiredSampleSize: number;
  assignmentUnit: "USER" | "ACCOUNT" | "SESSION";
  durationEstimateDays: number;
}

export interface ExperimentAssignment {
  experimentId: string;
  subjectId: string; // userId or orgId
  variant: "control" | "treatment";
  assignedAt: Date;
}

// ─── 5. UI Snapshot Crawler & Landing Page Audit Contracts ───────────────────

export interface UISnapshot {
  route: string;
  viewport: { width: number; height: number };
  screenshotUrl?: string;
  headings: Array<{ level: number; text: string }>;
  buttons: Array<{ text: string; selector: string; visible: boolean; enabled: boolean }>;
  forms: Array<{ selector: string; fields: string[] }>;
  links: Array<{ text: string; href: string }>;
  accessibilityIssues: string[];
  rawDomReference: string;
}

export interface LandingPageCROScore {
  aboveTheFold: {
    fiveSecondComprehensionScore: number; // 1 - 10
    valueClarityScore: number;            // 1 - 10
    icpSpecificityScore: number;         // 1 - 10
    differentiationScore: number;        // 1 - 10
    trustScore: number;                  // 1 - 10
    ctaClarityScore: number;             // 1 - 10
  };
  competitorComparison: Array<{
    competitorName: string;
    competitorClaim: string;
    ourClaim: string;
    differentiationGap: string;
  }>;
}

// ─── 6. Complete Machine-Readable Audit Output (`CROAuditResult`) ─────────────

export interface CROAuditResult {
  auditId: string;
  timestamp: Date;
  executiveDiagnosis: {
    primaryBottleneck: string;
    weakestPsychologicalStage: "attention" | "comprehension" | "trust" | "motivation" | "action";
    summary: string;
  };
  promiseVsRealityCheck: {
    landingPagePromise: string;
    onboardingReality: string;
    mismatchIdentified: boolean;
    explanation: string;
  };
  landingPageScore?: LandingPageCROScore;
  findings: CalculatedCROFinding[];
  challenges: CROChallenge[];
  topInterventions: CROIntervention[];
  rejectedRecommendations: Array<{
    findingId: string;
    reason: string;
  }>;
  experimentPlans: CROExperimentSpec[];
  telemetryRequirements: Array<{
    eventName: string;
    description: string;
    payloadSchema: Record<string, string>;
  }>;
}

// ─── Deterministic Evidence Validation Engine ────────────────────────────────

export function validateFindingEvidence(
  finding: CROFindingInput,
  validEvidenceLedger: CROEvidence[]
): { valid: boolean; missingEvidenceIds: string[]; error?: string } {
  if (!finding.evidenceIds || finding.evidenceIds.length === 0) {
    return {
      valid: false,
      missingEvidenceIds: [],
      error: `Finding ${finding.id} rejected: Zero evidence IDs provided. Model cannot invent un-grounded findings.`,
    };
  }

  const validSet = new Set(validEvidenceLedger.map((e) => e.id));
  const missingEvidenceIds = finding.evidenceIds.filter((id) => !validSet.has(id));

  if (missingEvidenceIds.length > 0) {
    return {
      valid: false,
      missingEvidenceIds,
      error: `Finding ${finding.id} rejected: Cited non-existent or un-grounded evidence IDs: [${missingEvidenceIds.join(", ")}].`,
    };
  }

  return { valid: true, missingEvidenceIds: [] };
}

// ─── Deterministic Scoring Engine Functions ──────────────────────────────────

export function calculateDeterministicExistenceConfidence(inputs: CROFindingInput["confidenceInputs"]): number {
  let score = 0;
  if (inputs.hasDirectDomEvidence) score += 0.30;
  if (inputs.hasAnalyticsEventData) score += 0.30;
  if (inputs.hasMultipleOccurrences) score += 0.15;
  if (inputs.hasUserResearchFeedback) score += 0.15;
  if (inputs.hasHistoricalExperimentData) score += 0.10;
  return Number(Math.min(1.0, score).toFixed(2));
}

export function calculateDeterministicCausalConfidence(
  inputs: CROFindingInput["confidenceInputs"],
  causalConfidenceInput?: number
): number {
  if (inputs.hasHistoricalExperimentData) return 0.90;
  if (inputs.hasAnalyticsEventData) return 0.75;
  const raw = causalConfidenceInput ?? 0.50;
  return Number(Math.max(0.10, Math.min(0.80, raw)).toFixed(2));
}

export function getEvidenceStrengthMultiplier(classification: FindingClassification): number {
  switch (classification) {
    case "OBSERVED":
      return 1.0;
    case "INFERRED":
      return 0.75;
    case "HYPOTHESIS":
      return 0.50;
  }
}

/**
 * Calculates priority score deterministically on the backend.
 * LLM supplies impact, effort, risk — application calculates priorityScore.
 */
export function evaluateCROFinding(input: CROFindingInput): CalculatedCROFinding {
  const existenceConfidence = calculateDeterministicExistenceConfidence(input.confidenceInputs);
  const causalConfidence = calculateDeterministicCausalConfidence(input.confidenceInputs, input.causalConfidenceInput);
  const evidenceStrength = getEvidenceStrengthMultiplier(input.classification);

  const normalizedExposure = Math.max(0.01, Math.min(1.0, input.exposureRate));
  const normalizedImpact = Math.max(1, Math.min(10, input.impact));
  const normalizedEffort = Math.max(1, Math.min(5, input.effort));
  const normalizedRisk = Math.max(1, Math.min(3, input.risk));

  const confidenceProduct = existenceConfidence * causalConfidence;
  const numerator = normalizedImpact * confidenceProduct * normalizedExposure * evidenceStrength;
  const denominator = normalizedEffort * normalizedRisk;

  const priorityScore = Number((numerator / denominator).toFixed(4));

  const { confidenceInputs, ...rest } = input;

  return {
    ...rest,
    confidence: {
      existence: existenceConfidence,
      causal: causalConfidence,
    },
    evidenceStrength,
    scoring: {
      impact: normalizedImpact,
      evidenceStrength,
      effort: normalizedEffort,
      risk: normalizedRisk,
      priorityScore,
    },
  };
}

// ─── 6. Domain Status-Driven Activation Progress Engine ──────────────────────

export interface ActivationState {
  mailboxConnected: boolean;
  domainStatus: DomainStatus;
  leadsImported: boolean;
  campaignConfigured: boolean;
  campaignLaunched: boolean;
}

export function computeActivationProgress(state: ActivationState) {
  const isDomainReady = state.domainStatus === "VERIFIED" || state.domainStatus === "PROPAGATING";

  const getDomainLabel = (status: DomainStatus) => {
    switch (status) {
      case "VERIFIED":
        return "Verify domain DNS & DKIM";
      case "PROPAGATING":
        return "Domain DKIM propagating (checking automatically in background)";
      case "MISSING":
        return "Configure missing DKIM TXT record";
      case "INCORRECT":
        return "Fix mismatched DNS records";
      case "UNAVAILABLE":
        return "DNS status check pending";
    }
  };

  const steps = [
    { key: "mailboxConnected", label: "Connect sending account", done: state.mailboxConnected },
    { key: "domainStatus", label: getDomainLabel(state.domainStatus), done: isDomainReady, status: state.domainStatus },
    { key: "leadsImported", label: "Import lead list", done: state.leadsImported },
    { key: "campaignConfigured", label: "Configure campaign", done: state.campaignConfigured },
    { key: "campaignLaunched", label: "Launch first campaign", done: state.campaignLaunched },
  ];

  const completedCount = steps.filter((s) => s.done).length;
  const progressPercent = Math.round((completedCount / steps.length) * 100);
  const estimatedTimeRemainingMinutes = Math.max(0, (steps.length - completedCount) * 2);

  return { steps, completedCount, progressPercent, estimatedTimeRemainingMinutes };
}

export function evaluateDnsRecoveryState(input: {
  dnsChecked: boolean;
  spfValid: boolean;
  dkimValid: boolean;
  dmarcValid: boolean;
  recordDetectedButPending?: boolean;
  dnsQueryError?: boolean;
}): { state: DomainStatus; userActionRequired: boolean; headline: string } {
  if (input.dnsQueryError) {
    return {
      state: "UNAVAILABLE",
      userActionRequired: false,
      headline: "DNS verification service temporarily unavailable. No user action required.",
    };
  }

  if (input.spfValid && input.dkimValid && input.dmarcValid) {
    return {
      state: "VERIFIED",
      userActionRequired: false,
      headline: "Domain DNS, DKIM, and DMARC fully verified.",
    };
  }

  if (input.recordDetectedButPending) {
    return {
      state: "PROPAGATING",
      userActionRequired: false,
      headline: "DKIM record detected. DNS propagation in progress (checking automatically in background).",
    };
  }

  if (!input.dkimValid && input.spfValid) {
    return {
      state: "MISSING",
      userActionRequired: true,
      headline: "DKIM authentication TXT record missing.",
    };
  }

  return {
    state: "INCORRECT",
    userActionRequired: true,
    headline: "DNS authentication records incomplete or mismatched.",
  };
}

// ─── 7. Persistent Experiment Assigner ──────────────────────────────────────

export function resolveDeterministicExperimentVariant(
  experimentId: string,
  subjectId: string,
  existingAssignments: ExperimentAssignment[],
  sampleRatio = 0.5
): ExperimentAssignment {
  const existing = existingAssignments.find(
    (a) => a.experimentId === experimentId && a.subjectId === subjectId
  );
  if (existing) return existing;

  let hash = 0;
  const str = `${experimentId}:${subjectId}`;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const normalized = (Math.abs(hash) % 1000) / 1000;
  const variant = normalized < sampleRatio ? "treatment" : "control";

  return {
    experimentId,
    subjectId,
    variant,
    assignedAt: new Date(),
  };
}

// ─── 8. Statistical Experiment Decision Engine ──────────────────────────────

export interface ExperimentEvaluationInput {
  hypothesisId: string;
  sampleSize: number;
  minRequiredSampleSize: number;
  primaryMetric: {
    controlRate: number;
    treatmentRate: number;
    targetRelativeLift: number;
    pValue: number;
  };
  guardrails: Array<{
    metricName: string;
    currentValue: number;
    maxAllowedThreshold: number;
  }>;
}

export function evaluateExperimentDecision(input: ExperimentEvaluationInput): {
  decision: "SHIP" | "ITERATE" | "ROLLBACK" | "INCONCLUSIVE";
  relativeLift: number;
  guardrailsPassed: boolean;
  rationale: string;
} {
  const relativeLift = Number(
    ((input.primaryMetric.treatmentRate - input.primaryMetric.controlRate) /
      (input.primaryMetric.controlRate || 1)).toFixed(4),
  );

  const guardrailsPassed = input.guardrails.every((g) => g.currentValue <= g.maxAllowedThreshold);

  if (!guardrailsPassed) {
    return {
      decision: "ROLLBACK",
      relativeLift,
      guardrailsPassed: false,
      rationale: "Rollback triggered: One or more deliverability/reputation guardrail metrics breached threshold.",
    };
  }

  if (input.sampleSize < input.minRequiredSampleSize) {
    return {
      decision: "INCONCLUSIVE",
      relativeLift,
      guardrailsPassed: true,
      rationale: `Sample size (${input.sampleSize}) below minimum required (${input.minRequiredSampleSize}).`,
    };
  }

  if (input.primaryMetric.pValue < 0.05 && relativeLift >= input.primaryMetric.targetRelativeLift) {
    return {
      decision: "SHIP",
      relativeLift,
      guardrailsPassed: true,
      rationale: `Statistically significant lift (+${(relativeLift * 100).toFixed(1)}%, p=${input.primaryMetric.pValue}) with all guardrails passing.`,
    };
  }

  if (relativeLift < 0 && input.primaryMetric.pValue < 0.05) {
    return {
      decision: "ROLLBACK",
      relativeLift,
      guardrailsPassed: true,
      rationale: `Statistically significant negative impact on primary metric (${(relativeLift * 100).toFixed(1)}%).`,
    };
  }

  return {
    decision: "ITERATE",
    relativeLift,
    guardrailsPassed: true,
    rationale: "Results inconclusive or lift target not fully met; iterate on treatment variant.",
  };
}
