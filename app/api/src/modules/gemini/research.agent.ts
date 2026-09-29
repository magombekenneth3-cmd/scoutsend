import { prisma } from "../../lib/prisma";
import { Prisma } from "@prisma/client";

import { redis } from "../../lib/ioredis";
import { serperSearch } from "../../lib/serper";
import { callGemini, callGeminiStream, extractJSON, MODELS } from "./gemini.client";
import { logger } from "../../lib/logger";
import { getOrFetchCompanyResearchContext } from "../../lib/company/company-research-context";
import {
  CompanySnapshot,
  CompetitiveContext,
  ICPAlignment,
  OutreachAngle,
  ResearchStreamEvent,
} from "../../lib/research/research.types";

const RESEARCH_TTL_MS = 24 * 60 * 60 * 1000;
const DDG_TIMEOUT_MS = 3_000;

interface SearchHit { title: string; link: string; snippet: string; date?: string }

async function fetchDuckDuckGo(query: string): Promise<SearchHit[]> {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(DDG_TIMEOUT_MS) });
    if (!res.ok) return [];
    const d = (await res.json()) as {
      RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
      AbstractText?: string;
      AbstractURL?: string;
    };
    const results: SearchHit[] = [];
    if (d.AbstractText) {
      results.push({ title: query, link: d.AbstractURL ?? "", snippet: d.AbstractText.slice(0, 220) });
    }
    for (const t of d.RelatedTopics ?? []) {
      if (t.Text && t.FirstURL) {
        results.push({ title: t.Text.slice(0, 80), link: t.FirstURL, snippet: t.Text.slice(0, 220) });
        if (results.length >= 3) break;
      }
    }
    return results;
  } catch {
    return [];
  }
}

async function safeSerper(query: string, type: "search" | "news" = "search"): Promise<SearchHit[]> {
  if (!process.env.SERPER_API_KEYS && !process.env.SERPER_API_KEY) return [];
  try {
    return await serperSearch(query, type, 6);
  } catch {
    return [];
  }
}

async function gatherStage(lead: FullLeadForResearch): Promise<{
  newsHits: SearchHit[];
  jobHits: SearchHit[];
  fundingHits: SearchHit[];
  scrapedContext: string;
  webSearchDegraded: boolean;
}> {
  if (lead.companyId) {
    try {
      const ctx = await getOrFetchCompanyResearchContext({
        companyId: lead.companyId,
        domain: lead.domain ?? lead.company?.domain,
        companyName: lead.companyName,
      });

      const newsHits: SearchHit[] = ctx.recentNews.map((n) => ({
        title: n.headline,
        link: n.url ?? "",
        snippet: n.snippet ?? "",
      }));
      const jobHits: SearchHit[] = ctx.jobSignals.map((j) => ({
        title: j.title,
        link: j.url ?? "",
        snippet: j.snippet ?? "",
      }));
      const fundingHits: SearchHit[] = ctx.fundingEvents.map((f) => ({
        title: f.description,
        link: "",
        snippet: f.snippet ?? "",
      }));

      const scrapedContext = buildScrapedContext(lead);
      const webSearchDegraded =
        newsHits.length === 0 && jobHits.length === 0 && fundingHits.length === 0 && !scrapedContext;
      return { newsHits, jobHits, fundingHits, scrapedContext, webSearchDegraded };
    } catch (err) {
      logger.debug({ err, leadId: lead.id }, "[research.agent] Company context fetch failed — falling back to raw search");
    }
  }

  const company = lead.companyName;
  const year = new Date().getFullYear();

  const [newsRaw, jobRaw, fundingRaw] = await Promise.all([
    safeSerper(`"${company}" news OR announcement OR launch ${year}`, "news"),
    safeSerper(`"${company}" hiring jobs ${year}`),
    safeSerper(`"${company}" funding OR raised OR investment OR series ${year - 1} OR ${year}`),
  ]);

  let newsHits = newsRaw;
  let jobHits = jobRaw;
  let fundingHits = fundingRaw;

  if (newsHits.length === 0) {
    newsHits = await fetchDuckDuckGo(`${company} news ${year}`);
  }
  if (fundingHits.length === 0) {
    fundingHits = await fetchDuckDuckGo(`${company} funding investment`);
  }

  const scrapedContext = buildScrapedContext(lead);
  const webSearchDegraded =
    newsHits.length === 0 && jobHits.length === 0 && fundingHits.length === 0 && !scrapedContext;

  return { newsHits, jobHits, fundingHits, scrapedContext, webSearchDegraded };
}

function buildScrapedContext(lead: FullLeadForResearch): string {
  const enrichData = (lead.company?.enrichmentData as Record<string, unknown> | null) ?? {};
  type ScrapedPage = { url: string; text: string };

  const pages = enrichData.scrapedPages;
  if (Array.isArray(pages) && pages.length > 0) {
    return (pages as ScrapedPage[])
      .map((p) => `[${p.url || "Website"}]\n${p.text}`)
      .join("\n\n")
      .slice(0, 6_000);
  }
  const legacy = enrichData.scrapedHomepageText;
  if (typeof legacy === "string" && legacy) return legacy.slice(0, 4_800);
  return "";
}

function hasEnrichmentContext(lead: FullLeadForResearch): boolean {
  const enrichment = lead.company?.enrichmentData;
  const hasData =
    enrichment !== null &&
    enrichment !== undefined &&
    typeof enrichment === "object" &&
    !Array.isArray(enrichment) &&
    Object.keys(enrichment as object).length > 0;
  const hasSignals = (lead.company?.signals?.length ?? 0) > 0;
  return hasData || hasSignals;
}

function buildDegradedFallback(
  lead: FullLeadForResearch,
): { snapshot: CompanySnapshot; alignment: ICPAlignment } {
  const e = (lead.company?.enrichmentData ?? {}) as Record<string, unknown>;
  const signals = lead.company?.signals ?? [];

  const snapshot: CompanySnapshot = {
    name: lead.companyName ?? "Unknown",
    domain: (e.domain as string | null) ?? lead.domain ?? null,
    industry: (e.industry as string | null) ?? null,
    employeeCount: typeof e.employeeCount === "number" ? e.employeeCount : null,
    revenueBand: (e.revenueBand as string | null) ?? null,
    businessModel: null,
    valueProposition: "Insufficient web search data to determine value proposition.",
    targetCustomer: "Unknown",
    techStack: signals
      .filter((s) => s.signalType === "TECH_SIGNAL")
      .map((s) => s.value),
    recentNews: [],
    hiringSignals: signals
      .filter((s) => s.signalType === "HIRING_SIGNAL")
      .map((s) => ({ role: s.value, signalValue: s.value, confidence: s.confidence, explanation: s.explanation ?? "" })),
    fundingEvents: signals
      .filter((s) => s.signalType === "FUNDING_SIGNAL")
      .map((s) => ({ description: s.value, amount: null, date: null, source: null })),
  };

  const alignment: ICPAlignment = {
    overallFitScore: 0,
    breakdown: { icpMatch: 0, intentStrength: 0, fundingSignals: 0, hiringVelocity: 0, techFit: 0, recency: 0 },
    fitNarrative: "Insufficient data — web search degraded and no prior enrichment available.",
    gapNarrative: "No web search results and no existing company enrichment data to evaluate ICP fit.",
    recommendedAction: "NURTURE",
    evidenceTriggers: [],
    contactFitNote: null,
  };

  return { snapshot, alignment };
}

function validateSnapshot(
  snapshot: CompanySnapshot,
  gathered: { newsHits: SearchHit[]; jobHits: SearchHit[]; fundingHits: SearchHit[]; scrapedContext: string },
  lead: FullLeadForResearch,
): CompanySnapshot {
  const allText = [
    ...gathered.newsHits.map((h) => `${h.title} ${h.snippet}`),
    ...gathered.jobHits.map((h) => `${h.title} ${h.snippet}`),
    ...gathered.fundingHits.map((h) => `${h.title} ${h.snippet}`),
    gathered.scrapedContext,
    JSON.stringify(lead.company?.enrichmentData ?? {}),
  ]
    .join(" ")
    .toLowerCase();

  const enriched = (lead.company?.enrichmentData ?? {}) as Record<string, unknown>;
  const enrichedTech = new Set(
    [
      ...((Array.isArray(enriched.techStack) ? enriched.techStack : []) as string[]),
      ...(lead.company?.signals ?? [])
        .filter((s) => s.signalType === "TECH_SIGNAL")
        .map((s) => s.value),
    ].map((t) => t.toLowerCase())
  );

  const validated: CompanySnapshot = { ...snapshot };

  if (typeof validated.employeeCount === "number") {
    const emp = String(validated.employeeCount);
    if (!allText.includes(emp)) {
      validated.employeeCount = null;
    }
  }

  if (validated.revenueBand) {
    const lower = validated.revenueBand.toLowerCase();
    const hasRevEvidence =
      allText.includes(lower) ||
      allText.includes("revenue") ||
      allText.includes("arr") ||
      allText.includes("mrr");
    if (!hasRevEvidence) {
      validated.revenueBand = null;
    }
  }

  validated.recentNews = (validated.recentNews ?? []).filter((n) => {
    const headlineWords = n.headline.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
    return headlineWords.some((w) => allText.includes(w));
  });

  validated.fundingEvents = (validated.fundingEvents ?? []).filter((f) => {
    const descWords = f.description.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
    return descWords.some((w) => allText.includes(w));
  });

  if (enrichedTech.size > 0) {
    validated.techStack = (validated.techStack ?? []).filter((t) =>
      Array.from(enrichedTech).some(
        (dt) => dt.includes(t.toLowerCase()) || t.toLowerCase().includes(dt)
      )
    );
  }

  return validated;
}

async function analyzeSnapshotAndICPAlignment(
  lead: FullLeadForResearch,
  gathered: Awaited<ReturnType<typeof gatherStage>>,
  campaign: { icpDescription: string }
): Promise<{ snapshot: CompanySnapshot; alignment: ICPAlignment }> {
  if (gathered.webSearchDegraded && !hasEnrichmentContext(lead)) {
    logger.info(
      { leadId: lead.id, companyName: lead.companyName },
      "[research.agent] Web search degraded and no enrichment context — skipping Gemini call, using fallback"
    );
    return buildDegradedFallback(lead);
  }

  const closedWorldConstraint = `CRITICAL — Closed-world extraction rules:
- Every quantitative field (employeeCount, revenueBand, fundingEvents.amount, fundingEvents.date) MUST be directly supported by the provided search results, scraped content, or enrichment data. If a value cannot be found verbatim or near-verbatim in the provided data, return null.
- Do NOT estimate, infer, or extrapolate numeric values (headcount, revenue, funding amounts). If absent from the evidence, return null.
- Do NOT invent or paraphrase company news not present in the news search results.
- Do NOT include techStack entries not present in the enrichment data or signals.
- Absence of evidence is NOT evidence of a value — use null, never a plausible guess.`;

  const scrapedBlock = gathered.scrapedContext
    ? `\n\nScraped website content:\n${gathered.scrapedContext}`
    : "";

  const { text } = await callGemini({
    agentName: "research.snapshot-and-alignment",
    model: MODELS.RESEARCH,
    systemPrompt: `You are a senior B2B sales intelligence analyst and go-to-market strategist. Analyze the target company and contact against raw web search data and campaign ICP. Produce BOTH a structured company snapshot AND a precise ICP alignment assessment. Return ONLY a single valid JSON object matching the schema. Do not include markdown, prose, or code fences.\n\n${closedWorldConstraint}`,
    userPrompt: `
Company: ${lead.companyName}
Website: ${lead.website ?? "unknown"}
Domain: ${lead.domain ?? "unknown"}
LinkedIn: ${lead.linkedinUrl ?? "unknown"}
Ideal Customer Profile: ${campaign.icpDescription}
Contact: ${[lead.firstName, lead.lastName].filter(Boolean).join(" ")} — ${lead.title ?? "unknown"} at ${lead.companyName} (${lead.seniority ?? "unknown"}, ${lead.department ?? "unknown"})

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
${scrapedBlock}

Return JSON:
{
  "snapshot": {
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
  },
  "alignment": {
    "overallFitScore": number (0-100),
    "breakdown": { "icpMatch": number, "intentStrength": number, "fundingSignals": number, "hiringVelocity": number, "techFit": number, "recency": number },
    "fitNarrative": string,
    "gapNarrative": string | null,
    "recommendedAction": "HIGH_PRIORITY" | "STANDARD" | "NURTURE" | "DISQUALIFY",
    "evidenceTriggers": string[],
    "contactFitNote": string | null
  }
}`,
    temperature: 0.2,
    responseMimeType: "application/json",
    metadata: { leadId: lead.id },
  });

  const parsed = extractJSON<{ snapshot: CompanySnapshot; alignment: ICPAlignment }>(text);
  parsed.snapshot = validateSnapshot(parsed.snapshot, gathered, lead);
  return parsed;
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

  const winRate = totalForSignals > 0 ? similarWins.length / totalForSignals : null;

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
  "similarWins": [{ "signalType": string, "signalValue": string, "replyIntent": string, "pipelineStageAtCapture": string | null, "subjectPattern": string }]
}`,
    temperature: 0.15,
    responseMimeType: "application/json",
    metadata: { leadId: lead.id },
  });
  const parsed = extractJSON<CompetitiveContext>(text);
  parsed.winRateForSignalType = winRate;
  return parsed;
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

interface UpsertedSignal {
  signalType: string;
  value: string;
  confidence: number;
  explanation: string;
}

async function upsertNewSignals(
  leadId: string,
  snapshot: CompanySnapshot,
): Promise<UpsertedSignal[]> {
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
    signalCandidates.map(async (s): Promise<UpsertedSignal> => {
      await prisma.leadSignal.upsert({
        where: { leadId_signalType_value: { leadId, signalType: s.signalType, value: s.value } },
        create: { leadId, signalType: s.signalType, value: s.value, confidence: s.confidence, source: s.source, explanation: s.explanation },
        update: { lastSeenAt: new Date(), confidence: s.confidence },
      });
      return { signalType: s.signalType, value: s.value, confidence: s.confidence, explanation: s.explanation };
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<UpsertedSignal> => r.status === "fulfilled")
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
          leads: { select: { id: true, firstName: true, lastName: true, title: true, seniority: true, department: true }, take: 5 },
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

  const latestSignal = await prisma.leadSignal.findFirst({
    where: { leadId, isActive: true, confidence: { gte: 0.8 } },
    orderBy: { createdAt: "desc" },
  });

  const completed = await prisma.leadResearchReport.findFirst({
    where: { leadId, status: "COMPLETE" },
    orderBy: { completedAt: "desc" },
  });

  if (completed && latestSignal && completed.completedAt && latestSignal.createdAt > completed.completedAt) {
    await prisma.leadResearchReport.delete({ where: { id: completed.id } }).catch(() => null);
  }

  return prisma.leadResearchReport.create({
    data: { leadId, status: "PENDING", triggeredById: userId },
  }).catch(async (err) => {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const winner = await prisma.leadResearchReport.findFirst({
        where: { leadId, status: { in: ["PENDING", "RUNNING"] } },
        orderBy: { startedAt: "desc" },
      });
      if (winner) return winner;
    }
    throw err;
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
    const { snapshot, alignment } = await analyzeSnapshotAndICPAlignment(lead, gathered, campaign);
    const stage1DurationMs = Date.now() - t1;

    emit({ type: "section", data: { section: "companySnapshot", payload: snapshot } });
    emit({ type: "section", data: { section: "icpAlignment", payload: alignment } });

    if (alignment.recommendedAction === "DISQUALIFY" || alignment.overallFitScore === 0) {
      const completedAt = new Date();
      const expiresAt = new Date(Date.now() + RESEARCH_TTL_MS);
      const phaseDurationsMs = { serper: serperDurationMs, stage1: stage1DurationMs, outreach: 0, total: Date.now() - t0 };
      await prisma.leadResearchReport.update({
        where: { id: reportId },
        data: {
          status: "COMPLETE",
          companySnapshot: snapshot as unknown as Prisma.InputJsonValue,
          icpAlignment: alignment as unknown as Prisma.InputJsonValue,
          phaseDurationsMs: phaseDurationsMs as unknown as Prisma.InputJsonValue,
          completedAt,
          expiresAt,
        },
      });
      emit({ type: "complete", data: { reportId, completedAt: completedAt.toISOString() } });
      return;
    }

    const t2 = Date.now();
    const competitive = await analyzeCompetitiveContext(lead, campaign, userId);
    const competitiveDurationMs = Date.now() - t2;

    emit({ type: "section", data: { section: "competitiveContext", payload: competitive } });

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
      emit({ type: "signal", data: { signalType: sig.signalType, value: sig.value, confidence: sig.confidence, explanation: sig.explanation } });
    }

    const completedAt = new Date();
    const expiresAt = new Date(Date.now() + RESEARCH_TTL_MS);

    const phaseDurationsMs = {
      serper: serperDurationMs,
      stage1: stage1DurationMs,
      competitive: competitiveDurationMs,
      outreach: outreachDurationMs,
      total: Date.now() - t0,
    };

    logger.info({ leadId, reportId, phaseDurationsMs }, "[research.agent] Phase durations");

    await prisma.leadResearchReport.update({
      where: { id: reportId },
      data: {
        status: outreachAngle ? "COMPLETE" : "PARTIAL",
        companySnapshot: snapshot as unknown as Prisma.InputJsonValue,
        competitiveContext: competitive as unknown as Prisma.InputJsonValue,
        icpAlignment: alignment as unknown as Prisma.InputJsonValue,
        outreachAngle: outreachAngle as unknown as Prisma.InputJsonValue,
        newSignalsFound: newSignals.map(s => `${s.signalType}: ${s.value}`) as Prisma.InputJsonValue,
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