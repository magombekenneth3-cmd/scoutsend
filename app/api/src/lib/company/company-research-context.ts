import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { redis } from "../ioredis";
import { logger } from "../logger";

export interface JobSignal {
  title: string;
  url?: string;
  snippet?: string;
}

export interface FundingEvent {
  description: string;
  amount?: string;
  date?: string;
  snippet?: string;
}

export interface NewsHit {
  headline: string;
  snippet?: string;
  url?: string;
}

export interface CommunityHit {
  platform: string;
  content: string;
  url?: string;
}

export interface CompanyResearchContext {
  companyId: string;
  domain: string;
  companyName: string;
  techStack: string[];
  jobSignals: JobSignal[];
  fundingEvents: FundingEvent[];
  recentNews: NewsHit[];
  communityPosts: CommunityHit[];
  fetchedAt: string;
}

const RESEARCH_CONTEXT_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const SERPER_TIMEOUT_MS = 4_000;

interface SerperHit {
  title: string;
  link: string;
  snippet: string;
}

async function fetchSerperRaw(query: string): Promise<SerperHit[]> {
  if (!process.env.SERPER_API_KEY) return [];
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": process.env.SERPER_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num: 5 }),
      signal: AbortSignal.timeout(SERPER_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const d = (await res.json()) as { organic?: SerperHit[] };
    return (d.organic ?? []).map((h) => ({
      title: h.title ?? "",
      link: h.link ?? "",
      snippet: h.snippet ? h.snippet.slice(0, 200) : "",
    }));
  } catch {
    return [];
  }
}

export async function getOrFetchCompanyResearchContext(params: {
  companyId: string;
  domain?: string | null;
  companyName: string;
}): Promise<CompanyResearchContext> {
  const { companyId, companyName } = params;
  const domain = (params.domain ?? "").toLowerCase().replace(/^www\./, "").trim();
  const cacheKey = `company:research-context:${domain || companyId}`;

  // 1. Try Redis cache (30-day TTL)
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as CompanyResearchContext;
    }
  } catch (err) {
    logger.debug({ err, companyId }, "[company-context] Redis read failed");
  }

  // 2. Try Prisma Company DB cache if enriched within 30 days
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      enrichmentData: true,
      lastEnrichedAt: true,
      signals: { orderBy: { confidence: "desc" }, take: 20 },
    },
  });

  const now = new Date();
  const isFresh =
    company?.lastEnrichedAt &&
    now.getTime() - new Date(company.lastEnrichedAt).getTime() <
      RESEARCH_CONTEXT_TTL_SECONDS * 1000;

  if (isFresh && company?.enrichmentData) {
    const data = company.enrichmentData as Record<string, unknown>;
    if (data.researchContext && typeof data.researchContext === "object") {
      const ctx = data.researchContext as CompanyResearchContext;
      await redis
        .set(cacheKey, JSON.stringify(ctx), "EX", RESEARCH_CONTEXT_TTL_SECONDS)
        .catch(() => null);
      return ctx;
    }
  }

  // 3. Fetch single unified Serper context for domain/company (1 fetch instead of 5)
  const searchDomain = domain || companyName;
  const year = now.getFullYear();

  const [newsHits, jobHits, fundingHits, communityHits] = await Promise.all([
    fetchSerperRaw(`"${companyName}" news OR launch OR announcement ${year}`),
    fetchSerperRaw(`"${companyName}" hiring jobs OR careers ${year}`),
    fetchSerperRaw(`"${companyName}" funding OR raised OR investment ${year - 1} OR ${year}`),
    fetchSerperRaw(`"${companyName}" site:reddit.com OR site:twitter.com OR site:linkedin.com`),
  ]);

  const existingSignals = company?.signals ?? [];
  const techStack = existingSignals
    .filter((s) => s.signalType === "TECH_SIGNAL")
    .map((s) => s.value);

  const context: CompanyResearchContext = {
    companyId,
    domain: domain || "",
    companyName,
    techStack,
    jobSignals: jobHits.map((h) => ({ title: h.title, url: h.link, snippet: h.snippet })),
    fundingEvents: fundingHits.map((h) => ({ description: h.title, snippet: h.snippet })),
    recentNews: newsHits.map((h) => ({ headline: h.title, snippet: h.snippet, url: h.link })),
    communityPosts: communityHits.map((h) => ({
      platform: h.link.includes("reddit.com")
        ? "Reddit"
        : h.link.includes("twitter.com") || h.link.includes("x.com")
        ? "X/Twitter"
        : "LinkedIn",
      content: `${h.title}: ${h.snippet}`,
      url: h.link,
    })),
    fetchedAt: now.toISOString(),
  };

  // Persist to Company model + Redis cache (30 days)
  await Promise.all([
    prisma.company
      .update({
        where: { id: companyId },
        data: {
          lastEnrichedAt: now,
          enrichmentData: {
            ...((company?.enrichmentData as Record<string, unknown>) ?? {}),
            researchContext: context as unknown as Prisma.InputJsonValue,
          } as unknown as Prisma.InputJsonValue,
        },
      })
      .catch(() => null),
    redis
      .set(cacheKey, JSON.stringify(context), "EX", RESEARCH_CONTEXT_TTL_SECONDS)
      .catch(() => null),
  ]);

  return context;
}
