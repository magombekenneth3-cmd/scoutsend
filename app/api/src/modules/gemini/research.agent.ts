import { prisma } from "../../lib/prisma";
import type { Prisma } from "@prisma/client";
import { callGemini, callGeminiStream, extractJSON, MODELS } from "./gemini.client";
import { logger } from "../../lib/logger";
import {
  CompanySnapshot,
  CompetitiveContext,
  ICPAlignment,
  OutreachAngle,
  ResearchStreamEvent,
} from "../../lib/research/research.types";

const RESEARCH_TTL_MS = 24 * 60 * 60 * 1000;
const SERPER_TIMEOUT_MS = 4_000;

interface SerperHit { title: string; link: string; snippet: string; date?: string }

async function fetchSerper(query: string): Promise<SerperHit[]> {
  if (!process.env.SERPER_API_KEY) return [];
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": process.env.SERPER_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num: 6, tbs: "qdr:m" }),
      signal: AbortSignal.timeout(SERPER_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const d = (await res.json()) as { organic?: SerperHit[] };
    return d.organic ?? [];
  } catch {
    return [];
  }
}

async function gatherStage(lead: FullLeadForResearch): Promise<{
  newsHits: SerperHit[];
  jobHits: SerperHit[];
  fundingHits: SerperHit[];
}> {
  const company = lead.companyName;
  const year = new Date().getFullYear();
  const [newsHits, jobHits, fundingHits] = await Promise.all([
    fetchSerper(`"${company}" news OR announcement OR launch ${year}`),
    fetchSerper(`"${company}" hiring jobs ${year}`),
    fetchSerper(`"${company}" funding OR raised OR investment OR series ${year - 1} OR ${year}`),
  ]);
  return { newsHits, jobHits, fundingHits };
}

async function analyzeCompanySnapshot(
  lead: FullLeadForResearch,
  gathered: Awaited<ReturnType<typeof gatherStage>>
): Promise<CompanySnapshot> {
  const { text } = await callGemini({
    agentName: "research.company-snapshot",
    model: MODELS.RESEARCH,
    systemPrompt: `You are a senior B2B sales intelligence analyst. Given structured data about a company and raw web search results, produce a structured company intelligence snapshot. Return ONLY a single valid JSON object matching the schema exactly. Do not include markdown, prose, or code fences.`,
    userPrompt: `
Company: ${lead.companyName}
Website: ${lead.website ?? "unknown"}
Domain: ${lead.domain ?? "unknown"}
LinkedIn: ${lead.linkedinUrl ?? "unknown"}

Existing enrichment:
${JSON.stringify(lead.company?.enrichmentData ?? {}, null, 2)}

Existing company signals:
${(lead.company?.signals ?? []).map(s => `- [${s.signalType}] ${s.value} (conf: ${s.confidence.toFixed(2)}): ${s.explanation ?? ""}`).join("\n") || "none"}

News search results:
${gathered.newsHits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.snippet}\n   ${h.link}`).join("\n\n") || "none"}

Job posting results:
${gathered.jobHits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.snippet}`).join("\n\n") || "none"}

Funding search results:
${gathered.fundingHits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.snippet}`).join("\n\n") || "none"}

Return JSON:
{
  "name": string,
  "domain": string | null,
  "industry": string | null,
  "employeeCount": number | null,
  "revenueBand": string | null,
  "businessModel": "SaaS" | "Services" | "Marketplace" | "Other" | null,
  "valueProposition": string,
  "targetCustomer": string,
  "techStack": string[],
  "recentNews": [{ "headline": string, "url": string, "publishedAt": string | null, "relevance": "HIGH"|"MEDIUM"|"LOW", "relevanceReason": string }],
  "hiringSignals": [{ "role": string, "signalValue": string, "confidence": number, "explanation": string }],
  "fundingEvents": [{ "description": string, "amount": string | null, "date": string | null, "source": string | null }]
}`,
    temperature: 0.2,
    responseMimeType: "application/json",
    metadata: { leadId: lead.id },
  });
  return extractJSON<CompanySnapshot>(text);
}

async function analyzeCompetitiveContext(
  lead: FullLeadForResearch,
  campaign: { icpDescription: string },
  userId: string,
): Promise<CompetitiveContext> {
  const similarWins = await prisma.winRecord.findMany({
    where: {
      signalType: { in: lead.signals.map(s => s.signalType) },
      campaign: { createdById: userId },
    },
    select: {
      signalType: true,
      signalValue: true,
      replyIntent: true,
      pipelineStageAtCapture: true,
      subjectPattern: true,
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const totalForSignals = await prisma.winRecord.count({
    where: {
      signalType: { in: lead.signals.map(s => s.signalType) },
      campaign: { createdById: userId },
    },
  });

  const { text } = await callGemini({
    agentName: "research.competitive-context",
    model: MODELS.RESEARCH,
    systemPrompt: `You are a B2B competitive intelligence analyst. Assess how a lead's tech stack and signals create opportunities for displacement or complementary positioning. Return ONLY a single valid JSON object matching the schema exactly. Do not include markdown, prose, or code fences.`,
    userPrompt: `
Lead: ${lead.companyName}
Competitor signal detected: ${lead.competitorSignal}
Competitor tech in use: ${(lead.competitorTech ?? []).join(", ") || "none"}
All signals: ${lead.signals.map(s => `[${s.signalType}] ${s.value}`).join(", ") || "none"}
Campaign ICP: ${campaign.icpDescription}

Historical wins on same signal types (${totalForSignals} total):
${similarWins.map(w => `- ${w.signalType}: "${w.signalValue}" — intent=${w.replyIntent}, stage=${w.pipelineStageAtCapture}, subject="${w.subjectPattern}"`).join("\n") || "none"}

Return JSON:
{
  "competitorSignalDetected": boolean,
  "competitorProducts": string[],
  "displacementAngle": string | null,
  "complementaryAngle": string | null,
  "similarWins": [{ "signalType": string, "signalValue": string, "replyIntent": string, "pipelineStageAtCapture": string | null, "subjectPattern": string }],
  "winRateForSignalType": number | null
}`,
    temperature: 0.15,
    responseMimeType: "application/json",
    metadata: { leadId: lead.id },
  });
  return extractJSON<CompetitiveContext>(text);
}

async function analyzeICPAlignment(
  lead: FullLeadForResearch,
  campaign: { icpDescription: string },
  snapshot: CompanySnapshot,
): Promise<ICPAlignment> {
  const { text } = await callGemini({
    agentName: "research.icp-alignment",
    model: MODELS.RESEARCH,
    systemPrompt: `You are a B2B go-to-market strategist. Given the campaign ICP and the company profile produced by the snapshot agent, produce a precise ICP alignment assessment. Do not be vague. Be specific about where they fit and where they don't. Return ONLY a single valid JSON object matching the schema exactly. Do not include markdown, prose, or code fences.`,
    userPrompt: `
Ideal Customer Profile:
${campaign.icpDescription}

Contact: ${[lead.firstName, lead.lastName].filter(Boolean).join(" ")} — ${lead.title ?? "unknown"} at ${lead.companyName}
Seniority: ${lead.seniority ?? "unknown"}
Department: ${lead.department ?? "unknown"}
Recommended action on file: ${lead.recommendedAction ?? "none"}

Company profile (from snapshot agent):
${JSON.stringify({
      industry: snapshot.industry,
      businessModel: snapshot.businessModel,
      employeeCount: snapshot.employeeCount,
      revenueBand: snapshot.revenueBand,
      valueProposition: snapshot.valueProposition,
      targetCustomer: snapshot.targetCustomer,
      techStack: snapshot.techStack,
      topHiringSignals: snapshot.hiringSignals.slice(0, 3).map(h => h.explanation),
      topFundingEvents: snapshot.fundingEvents.slice(0, 2).map(f => f.description),
    }, null, 2)}

Return JSON:
{
  "overallFitScore": number (0-100),
  "breakdown": { "icpMatch": number, "intentStrength": number, "fundingSignals": number, "hiringVelocity": number, "techFit": number, "recency": number },
  "fitNarrative": string (2-3 sentences on why this is a good fit — be concrete),
  "gapNarrative": string | null (1-2 sentences on what's missing or weak — null if no meaningful gap),
  "recommendedAction": "HIGH_PRIORITY" | "STANDARD" | "NURTURE" | "DISQUALIFY",
  "evidenceTriggers": string[] (3-5 specific facts that most directly support reaching out now),
  "contactFitNote": string | null (note on whether this specific person is the right contact — role, seniority, decision-making authority)
}`,
    temperature: 0.2,
    responseMimeType: "application/json",
    metadata: { leadId: lead.id },
  });
  return extractJSON<ICPAlignment>(text);
}

async function synthesizeOutreachAngle(
  lead: FullLeadForResearch,
  campaign: { icpDescription: string; name: string },
  snapshot: CompanySnapshot,
  competitive: CompetitiveContext,
  alignment: ICPAlignment,
  options: { stream: boolean; onChunk?: (text: string) => void },
): Promise<OutreachAngle> {
  const promptConfig = {
    agentName: "research.outreach-angle",
    model: MODELS.GENERATE,
    systemPrompt: `You are a senior sales strategist who writes cold outreach angles that don't feel like cold outreach. Your output is consumed by a sales rep who will adapt it, not copy it verbatim. Be specific to this company and this contact — no generic phrases. No "I came across your profile", no "I'd love to connect", no "I hope this email finds you well." Return ONLY a single valid JSON object matching the schema exactly. Do not include markdown, prose, or code fences.`,
    userPrompt: `
Campaign: ${campaign.name}

Contact: ${[lead.firstName, lead.lastName].filter(Boolean).join(" ")} (${lead.title ?? "unknown"}, ${lead.seniority ?? ""} ${lead.department ?? ""})

Company snapshot:
${JSON.stringify({
      name: snapshot.name,
      valueProposition: snapshot.valueProposition,
      businessModel: snapshot.businessModel,
      techStack: snapshot.techStack,
      topNews: snapshot.recentNews.filter(n => n.relevance === "HIGH").slice(0, 3).map(n => ({ headline: n.headline, relevanceReason: n.relevanceReason })),
      topHiring: snapshot.hiringSignals.slice(0, 3).map(h => ({ role: h.role, explanation: h.explanation })),
      topFunding: snapshot.fundingEvents.slice(0, 2).map(f => ({ description: f.description, amount: f.amount })),
    }, null, 2)}

ICP alignment:
${JSON.stringify({
      overallFitScore: alignment.overallFitScore,
      fitNarrative: alignment.fitNarrative,
      gapNarrative: alignment.gapNarrative,
      evidenceTriggers: alignment.evidenceTriggers.slice(0, 3),
      contactFitNote: alignment.contactFitNote,
      recommendedAction: alignment.recommendedAction,
    }, null, 2)}

Competitive context:
${JSON.stringify({
      competitorProducts: competitive.competitorProducts,
      displacementAngle: competitive.displacementAngle,
      complementaryAngle: competitive.complementaryAngle,
      winPatterns: competitive.similarWins.slice(0, 3).map(w => ({ subjectPattern: w.subjectPattern, replyIntent: w.replyIntent })),
    }, null, 2)}

Return JSON:
{
  "primaryAngle": string (one sentence — the core insight that makes this company worth reaching out to right now),
  "angleRationale": string (2-3 sentences on why this angle works for this specific contact at this specific company),
  "talkTracks": [
    {
      "trigger": string (the specific signal/event being referenced),
      "hook": string (1 sentence opener referencing the trigger without being creepy about it),
      "value": string (1-2 sentences on what value you're offering, tied directly to their likely pain),
      "cta": string (soft, specific CTA — not "jump on a call", something more concrete)
    }
  ] (2-3 tracks, each using a different trigger),
  "subjectLineVariants": string[] (3 subject lines — short, specific, no clickbait),
  "openingLineSuggestion": string (one strong opening line that doesn't start with "I"),
  "warningsAndAvoid": string[] (things NOT to say given what you know — competitor sensitivities, overused angles, etc)
}`,
    temperature: 0.65,
    responseMimeType: "application/json",
    metadata: { leadId: lead.id },
  };

  if (options.stream && options.onChunk) {
    let accumulated = "";
    await callGeminiStream({
      ...promptConfig,
      onChunk: (chunk) => {
        accumulated += chunk;
        options.onChunk!(chunk);
      },
    });
    return extractJSON<OutreachAngle>(accumulated);
  }

  const { text } = await callGemini(promptConfig);
  return extractJSON<OutreachAngle>(text);
}

async function upsertNewSignals(
  leadId: string,
  snapshot: CompanySnapshot,
): Promise<string[]> {
  const signalCandidates = [
    ...snapshot.hiringSignals.map(h => ({
      signalType: "HIRING_SIGNAL" as const,
      value: h.signalValue,
      confidence: h.confidence,
      explanation: h.explanation,
      source: "research_agent",
    })),
    ...snapshot.fundingEvents.map(f => ({
      signalType: "FUNDING_SIGNAL" as const,
      value: f.description,
      confidence: f.amount ? 0.85 : 0.65,
      explanation: f.amount ? `${f.description} — ${f.amount}` : f.description,
      source: "research_agent",
    })),
    ...snapshot.recentNews
      .filter(n => n.relevance === "HIGH")
      .map(n => ({
        signalType: "GROWTH_SIGNAL" as const,
        value: n.headline.slice(0, 120),
        confidence: n.relevance === "HIGH" ? 0.85 : n.relevance === "MEDIUM" ? 0.65 : 0.40,
        explanation: n.relevanceReason,
        source: "research_agent",
      })),
  ];

  const results = await Promise.allSettled(
    signalCandidates.map(async (s) => {
      await prisma.leadSignal.upsert({
        where: { leadId_signalType_value: { leadId, signalType: s.signalType, value: s.value } },
        create: { leadId, signalType: s.signalType, value: s.value, confidence: s.confidence, source: s.source, explanation: s.explanation },
        update: { lastSeenAt: new Date(), confidence: s.confidence },
      });
      return `${s.signalType}: ${s.value}`;
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
    .map((r) => r.value);
}

type FullLeadForResearch = Awaited<ReturnType<typeof fetchLeadForResearch>>;

async function fetchLeadForResearch(leadId: string) {
  return prisma.lead.findUniqueOrThrow({
    where: { id: leadId },
    include: {
      signals: { where: { isActive: true }, orderBy: { confidence: "desc" }, take: 20 },
      company: {
        include: {
          signals: { where: { isActive: true }, orderBy: { confidence: "desc" }, take: 15 },
          engagement: true,
        },
      },
      campaign: { select: { id: true, name: true, icpDescription: true } },
      outreachMessages: { select: { deliveryState: true, sentAt: true, openedAt: true }, orderBy: { sentAt: "desc" }, take: 5 },
      replies: { select: { intent: true, sentimentScore: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 3 },
    },
  });
}

const activeJobs = new Map<
  string,
  {
    reportId: string;
    listeners: Set<(event: ResearchStreamEvent) => void>;
    promise: Promise<void>;
  }
>();

export async function findOrCreatePendingReport(
  leadId: string,
  userId: string,
) {
  const existing = await prisma.leadResearchReport.findFirst({
    where: { leadId, status: { in: ["PENDING", "RUNNING"] } },
    orderBy: { startedAt: "desc" },
  });
  if (existing) return existing;
  return prisma.leadResearchReport.create({
    data: { leadId, status: "PENDING", triggeredById: userId },
  });
}

export function unsubscribeResearchListener(
  leadId: string,
  emit: (event: ResearchStreamEvent) => void,
) {
  const job = activeJobs.get(leadId);
  if (job) {
    job.listeners.delete(emit);
  }
}

export function hasActiveJob(leadId: string): boolean {
  return activeJobs.has(leadId);
}


export async function runResearchAgent(
  leadId: string,
  reportId: string,
  emit: (event: ResearchStreamEvent) => void,
  userId: string,
): Promise<void> {
  const existingJob = activeJobs.get(leadId);
  if (existingJob) {
    existingJob.listeners.add(emit);
    return existingJob.promise;
  }

  const listeners = new Set<(event: ResearchStreamEvent) => void>();
  listeners.add(emit);

  const broadcast = (event: ResearchStreamEvent) => {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // ignore closed connection errors
      }
    }
  };

  const promise = (async () => {
    try {
      await runCoreResearchAgent(leadId, reportId, broadcast, userId);
    } finally {
      activeJobs.delete(leadId);
      listeners.clear();
    }
  })();

  activeJobs.set(leadId, {
    reportId,
    listeners,
    promise,
  });

  return promise;
}

async function runCoreResearchAgent(
  leadId: string,
  reportId: string,
  emit: (event: ResearchStreamEvent) => void,
  userId: string,
): Promise<void> {
  try {
    await prisma.leadResearchReport.update({
      where: { id: reportId },
      data: { status: "RUNNING" },
    });

    emit({ type: "status", data: { status: "RUNNING" } });

    const lead = await fetchLeadForResearch(leadId);
    const campaign = lead.campaign;

    const t0 = Date.now();
    const gathered = await gatherStage(lead);
    const serperDurationMs = Date.now() - t0;

    const t1 = Date.now();
    const [snapshot, competitive] = await Promise.all([
      analyzeCompanySnapshot(lead, gathered),
      analyzeCompetitiveContext(lead, campaign, userId),
    ]);
    const geminiStage1DurationMs = Date.now() - t1;

    emit({ type: "section", data: { section: "companySnapshot", payload: snapshot } });
    emit({ type: "section", data: { section: "competitiveContext", payload: competitive } });

    await prisma.leadResearchReport.update({
      where: { id: reportId },
      data: {
        companySnapshot: snapshot as unknown as Prisma.InputJsonValue,
        competitiveContext: competitive as unknown as Prisma.InputJsonValue,
      },
    });

    const t2 = Date.now();
    const alignment = await analyzeICPAlignment(lead, campaign, snapshot);
    const alignmentDurationMs = Date.now() - t2;

    emit({ type: "section", data: { section: "icpAlignment", payload: alignment } });

    await prisma.leadResearchReport.update({
      where: { id: reportId },
      data: { icpAlignment: alignment as unknown as Prisma.InputJsonValue },
    });

    const t3 = Date.now();
    let outreachAngle: OutreachAngle | null = null;
    try {
      outreachAngle = await synthesizeOutreachAngle(
        lead, campaign, snapshot, competitive, alignment,
        {
          stream: true,
          onChunk: (chunk) => emit({ type: "section", data: { section: "outreachAngle", payload: { chunk } } }),
        },
      );
      emit({ type: "section", data: { section: "outreachAngle", payload: outreachAngle } });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Outreach angle synthesis failed";
      logger.warn({ err, leadId }, "[research.agent] Outreach angle synthesis failed — continuing");
      emit({ type: "section_failed", data: { section: "outreachAngle", message } });
    }
    const outreachDurationMs = Date.now() - t3;

    const newSignals = await upsertNewSignals(leadId, snapshot);
    for (const sig of newSignals) {
      const [signalType, ...rest] = sig.split(": ");
      emit({ type: "signal", data: { signalType, value: rest.join(": "), confidence: 0.75, explanation: "Discovered during research" } });
    }

    const completedAt = new Date();
    const expiresAt = new Date(Date.now() + RESEARCH_TTL_MS);

    const phaseDurationsMs = {
      serper: serperDurationMs,
      geminiStage1: geminiStage1DurationMs,
      alignment: alignmentDurationMs,
      outreach: outreachDurationMs,
      total: Date.now() - t0,
    };

    logger.info({ leadId, reportId, phaseDurationsMs }, "[research.agent] Phase durations");

    await prisma.leadResearchReport.update({
      where: { id: reportId },
      data: {
        status: "COMPLETE",
        outreachAngle: outreachAngle as unknown as Prisma.InputJsonValue,
        newSignalsFound: newSignals as Prisma.InputJsonValue,
        phaseDurationsMs: phaseDurationsMs as unknown as Prisma.InputJsonValue,
        completedAt,
        expiresAt,
      },
    });

    emit({ type: "complete", data: { reportId, completedAt: completedAt.toISOString() } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Research agent failed";
    logger.error({ err, leadId, reportId }, "[research.agent] Fatal error");

    await prisma.leadResearchReport.update({
      where: { id: reportId },
      data: { status: "FAILED", errorMessage: message },
    }).catch(() => { });

    emit({ type: "error", data: { message } });
    emit({ type: "status", data: { status: "FAILED" } });
  }
}