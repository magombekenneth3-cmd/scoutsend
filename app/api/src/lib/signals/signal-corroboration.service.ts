import { SignalType } from "@prisma/client";

export const SCORING_POLICY_VERSION = "3.3.0";

export interface IntentSignal {
  id: string;
  leadId: string;
  type: SignalType;
  value: string;
  confidence: number;
  source: string;
  sourceId?: string;
  independenceKey: string;
  observedAt: Date;
  expiresAt?: Date;
}

export interface CorroborationResult {
  corroboratedScore: number;
  signalCount: number;
  independentSignalCount: number;
  strongestSignalType: SignalType | null;
  evidenceSummary: string[];
  scoringPolicyVersion: string;
}

// ---------------------------------------------------------------------------
// Source quality weights — higher = more trustworthy data origin
// ---------------------------------------------------------------------------

const SOURCE_QUALITY: Record<string, number> = {
  apollo: 0.80,
  clearbit: 0.85,
  linkedin: 0.90,
  builtwith: 0.85,
  crunchbase: 0.90,
  serper: 0.70,
  website_scrape: 0.75,
  community_intent: 0.65,
  heuristic: 0.40,
};

// ---------------------------------------------------------------------------
// ICP relevance per signal type
// ---------------------------------------------------------------------------

const ICP_RELEVANCE: Partial<Record<SignalType, number>> = {
  INTENT_SIGNAL: 0.95,
  HIRING_SIGNAL: 0.90,
  FUNDING_SIGNAL: 0.85,
  TECH_SIGNAL: 0.85,
  GROWTH_SIGNAL: 0.80,
  WEBSITE_COPY: 0.70,
  RISK_SIGNAL: 0.30,
  UNKNOWN: 0.20,
};

// Signals with the same independenceKey come from the same underlying data
// source and must not be double-counted. The second and subsequent signals
// sharing a key receive a 75% penalty multiplier.
const INDEPENDENCE_PENALTY = 0.25;

// Half-life for recency decay in days. A signal observed 30 days ago scores
// 50% of a fresh signal.
const RECENCY_HALF_LIFE_DAYS = 30;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function recencyFactor(observedAt: Date, now: Date = new Date()): number {
  const ageDays =
    (now.getTime() - observedAt.getTime()) / (1000 * 60 * 60 * 24);
  return Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
}

// ---------------------------------------------------------------------------
// Core corroboration algorithm
//
// Composite signal score = Σ (per signal):
//   confidence × recency × icpRelevance × sourceQuality × independenceMult
//
// The resulting corroboratedScore is clamped to [0, 1].
// ---------------------------------------------------------------------------

export function corroborateSignals(
  signals: IntentSignal[],
  now: Date = new Date(),
): CorroborationResult {
  const seenIndependenceKeys = new Set<string>();
  const evidenceSummary: string[] = [];
  let totalScore = 0;
  let independentCount = 0;
  let strongestScore = 0;
  let strongestType: SignalType | null = null;

  for (const signal of signals) {
    // Skip expired signals
    if (signal.expiresAt && signal.expiresAt < now) continue;

    const sourceQuality = SOURCE_QUALITY[signal.source] ?? 0.50;
    const icpRelevance = ICP_RELEVANCE[signal.type] ?? 0.50;
    const recency = recencyFactor(signal.observedAt, now);

    const alreadySeen = seenIndependenceKeys.has(signal.independenceKey);
    const independenceMult = alreadySeen ? INDEPENDENCE_PENALTY : 1.0;

    if (!alreadySeen && signal.independenceKey) {
      seenIndependenceKeys.add(signal.independenceKey);
      independentCount++;
    }

    const signalStrength =
      signal.confidence *
      recency *
      icpRelevance *
      sourceQuality *
      independenceMult;

    totalScore += signalStrength;

    if (signalStrength > strongestScore) {
      strongestScore = signalStrength;
      strongestType = signal.type;
    }

    evidenceSummary.push(
      `[${signal.type}] ${signal.value} (src=${signal.source}, conf=${signal.confidence.toFixed(2)}, recency=${recency.toFixed(2)}, indep=${alreadySeen ? "NO" : "YES"})`,
    );
  }

  return {
    corroboratedScore: Math.min(totalScore, 1.0),
    signalCount: signals.length,
    independentSignalCount: independentCount,
    strongestSignalType: strongestType,
    evidenceSummary,
    scoringPolicyVersion: SCORING_POLICY_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Adapter: convert Prisma LeadSignal rows to IntentSignal for corroboration
// ---------------------------------------------------------------------------

export function adaptLeadSignals(
  rows: Array<{
    id: string;
    leadId: string;
    signalType: SignalType;
    value: string;
    confidence: number;
    source: string | null;
    sourceId: string | null;
    independenceKey: string;
    firstSeenAt: Date;
    expiresAt: Date | null;
  }>,
): IntentSignal[] {
  return rows.map((r) => ({
    id: r.id,
    leadId: r.leadId,
    type: r.signalType,
    value: r.value,
    confidence: r.confidence,
    source: r.source ?? "unknown",
    sourceId: r.sourceId ?? undefined,
    independenceKey: r.independenceKey || `${r.signalType}:${r.value}`,
    observedAt: r.firstSeenAt,
    expiresAt: r.expiresAt ?? undefined,
  }));
}
