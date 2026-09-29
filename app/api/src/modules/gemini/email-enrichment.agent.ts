import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { acquireLeadLock } from "../../lib/prisma-locks";
import { emailGenerationQueue } from "./campaign.queue";
import { emailEnrichmentQueue } from "./email-enrichment.queue";
import { enqueueCompanyScrape, enqueueCompanyScrapes } from "./company-scrape.queue";
import { createLinkedInProvider } from "../../lib/linkedIn";
import pLimit from "p-limit";
import { Prisma } from "@prisma/client";
import { enrichPersonWaterfall } from "../../lib/providers";
import { discoverDomainEmails, matchLeadToDiscovery } from "../../lib/website-email-discovery";
import dns from "dns";
import { ApiKeyVault } from "../../lib/key-manager";
import {
    buildEnrichmentCacheKey,
    getCachedEnrichmentValue,
    setCachedEnrichmentValue,
    type CachedEmailResolution,
} from "./enrichment-cache";
import { populateTechSignals } from "./discoveryLib/builtWith";
import { emitCampaignEvent } from "../../lib/campaign-events";
import { assertPublicHttpUrl } from "../../lib/url-safety";
import { redis } from "../../lib/ioredis";
import { recordEnrichmentCost, isCampaignBudgetExhausted } from "./enrichment-cost.service";

const APOLLO_RETRY_BASE_MS = 2_000;
const APOLLO_REVEAL_MAX_RETRIES = 2;

const APOLLO_BULK_MATCH_SIZE = 10;
const EXTERNAL_FETCH_TIMEOUT_MS = 10_000;
const HUNTER_MIN_SCORE = 70;
const PAID_VERIFICATION_MIN_SCORE = 75;
const PAID_VERIFICATION_MIN_ACTION_SCORE = 70;
const ZEROBOUNCE_BLOCK_STATUSES = new Set(["invalid", "spamtrap", "abuse", "do_not_mail"]);

const apolloEnrichVault = new ApiKeyVault("apollo-enrich", "APOLLO_API_KEYS");
const hunterVault = new ApiKeyVault("hunter", "HUNTER_API_KEYS");

const CROSS_CAMPAIGN_CACHE_MAX_AGE_DAYS = 30;
const COMPANY_CONTEXT_FRESHNESS_MS = 14 * 24 * 60 * 60_000;

const MAX_VERIFICATION_RETRIES = 5;
const VERIFICATION_RETRY_BASE_DELAY_MS = 10 * 60_000;
const VERIFICATION_RETRY_MAX_DELAY_MS = 6 * 60 * 60_000;
const SERPER_TIMEOUT_MS = 5_000;
const WEBSITE_DISCOVERY_CACHE_TTL_S = 60 * 60 * 24 * 7;

export const EMAIL_STATUS = {
    NOT_ATTEMPTED: "NOT_ATTEMPTED",
    PENDING: "PENDING",
    FOUND: "FOUND",
    NOT_FOUND: "NOT_FOUND",
    PENDING_VERIFICATION: "PENDING_VERIFICATION",
} as const;
export type EmailStatus = (typeof EMAIL_STATUS)[keyof typeof EMAIL_STATUS];

export const EMAIL_SOURCE = {
    APOLLO_SEARCH: "APOLLO_SEARCH",
    APOLLO_REVEAL: "APOLLO_REVEAL",
    HUNTER: "HUNTER",
    CAMPAIGN_CACHE: "CAMPAIGN_CACHE",
    WATERFALL: "WATERFALL",
    WEBSITE_DIRECT: "WEBSITE_DIRECT",
    WEBSITE_PATTERN: "WEBSITE_PATTERN",
    HARVESTAPI: "HARVESTAPI",
} as const;
export type EmailSource = (typeof EMAIL_SOURCE)[keyof typeof EMAIL_SOURCE];

export type EmailVerificationOutcome =
    | { kind: "verified"; verified: boolean; catchAll: boolean }
    | { kind: "blocked" }
    | { kind: "not_configured" }
    | { kind: "transient_failure"; reason: string };

interface CachedEmailResult {
    email: string;
    catchAll: boolean;
}

interface VerificationRetryState {
    [key: string]: unknown;
    retryCount: number;
    lastFailureReason: string;
    firstFailedAt: string;
    lastAttemptAt: string;
    exhausted: boolean;
}

function assertEnv(): void {
    const hasApollo = Boolean(process.env.APOLLO_API_KEYS || process.env.APOLLO_API_KEY);
    const hasHunter = Boolean(process.env.HUNTER_API_KEYS || process.env.HUNTER_API_KEY);
    if (!hasApollo || !hasHunter) {
        logger.info({ hasApollo, hasHunter }, "[email-enrichment] Checking optional enrichment API keys");
    }
    if (!process.env.ZEROBOUNCE_API_KEY) {
        logger.warn(
            "[email-enrichment] ZEROBOUNCE_API_KEY not set — email verification is disabled; discovered emails will be saved unverified",
        );
    }
}

function extractDomain(enrichmentData: unknown, website: string | null | undefined): string | null {
    if (enrichmentData && typeof enrichmentData === "object") {
        const d = enrichmentData as Record<string, unknown>;
        if (typeof d.domain === "string" && d.domain) return d.domain;
    }
    if (website) {
        try {
            const w = website.trim();
            const href = /^https?:\/\//i.test(w) ? w : `https://${w}`;
            return new URL(href).hostname.replace(/^www\./, "");
        } catch {
            return null;
        }
    }
    return null;
}

async function discoverWebsiteViaSerp(companyName: string): Promise<string | null> {
    const serperKey = process.env.SERPER_API_KEY || process.env.SERPER_API_KEYS;
    if (!serperKey) return null;

    const cacheKey = `website-discovery:serp:${Buffer.from(companyName.toLowerCase()).toString("base64url")}`;
    try {
        const cached = await redis.get(cacheKey);
        if (cached) return cached;
    } catch { }

    try {
        const res = await fetch("https://google.serper.dev/search", {
            method: "POST",
            headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
            body: JSON.stringify({ q: `${companyName} official website`, num: 5 }),
            signal: AbortSignal.timeout(SERPER_TIMEOUT_MS),
        });
        if (!res.ok) return null;

        const data = (await res.json()) as { organic?: Array<{ link?: string }> };
        const hits = data.organic ?? [];

        for (const hit of hits) {
            const link = hit.link?.trim();
            if (!link) continue;
            try {
                const validated = await assertPublicHttpUrl(link);
                const website = validated.origin;
                await redis.set(cacheKey, website, "EX", WEBSITE_DISCOVERY_CACHE_TTL_S).catch(() => null);
                return website;
            } catch { }
        }
    } catch (err) {
        logger.warn({ err, companyName }, "[email-enrichment] SERP website discovery failed");
    }

    return null;
}

async function maybeResolveFromEnrichmentCache(params: {
    companyId: string | null;
    firstName: string | null;
    lastName: string | null;
    domain: string | null;
    email: string | null;
}): Promise<CachedEmailResolution | null> {
    const key = buildEnrichmentCacheKey([
        params.companyId,
        params.firstName,
        params.lastName,
        params.domain,
        params.email,
    ]);

    if (key === "enrichment:empty") return null;
    return getCachedEnrichmentValue<CachedEmailResolution>(key, "person");
}

async function cacheResolvedEmail(params: {
    companyId: string | null;
    firstName: string | null;
    lastName: string | null;
    domain: string | null;
    email: string | null;
    resolution: CachedEmailResolution;
}): Promise<void> {
    const key = buildEnrichmentCacheKey([
        params.companyId,
        params.firstName,
        params.lastName,
        params.domain,
        params.email,
    ]);

    if (key === "enrichment:empty") return;
    await setCachedEnrichmentValue(key, "person", params.resolution);
}

function readEnrichmentData(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function nextRetryState(existing: Record<string, unknown>, reason: string): VerificationRetryState {
    const prior = existing.emailVerification as Partial<VerificationRetryState> | undefined;
    const now = new Date().toISOString();
    const retryCount = (prior?.retryCount ?? 0) + 1;
    return {
        retryCount,
        lastFailureReason: reason,
        firstFailedAt: prior?.firstFailedAt ?? now,
        lastAttemptAt: now,
        exhausted: retryCount > MAX_VERIFICATION_RETRIES,
    };
}

const NICKNAME_GROUPS: string[][] = [
    ["robert", "rob", "bob", "bobby"],
    ["david", "dave"],
    ["michael", "mike"],
    ["alexander", "alexandra", "alex"],
    ["daniel", "dan", "danny"],
    ["christopher", "christian", "chris"],
    ["matthew", "matt"],
    ["william", "will", "bill", "billy"],
    ["james", "jim", "jimmy"],
    ["thomas", "tom", "tommy"],
    ["benjamin", "ben"],
    ["samuel", "samantha", "sam"],
    ["joseph", "joe", "joey"],
    ["nicholas", "nick"],
    ["gregory", "greg"],
    ["timothy", "tim"],
    ["steven", "stephen", "steve"],
    ["jonathan", "john", "jon", "jack"],
    ["richard", "rick", "dick"],
    ["charles", "charlie", "chuck"],
    ["andrew", "andy"],
    ["anthony", "tony"],
];

function cleanName(raw: string): string {
    return raw
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\b(jr|sr|iii|ii|iv|esq|phd|md)\b/gi, "")
        .replace(/[^a-z\s]/g, " ")
        .trim();
}

function areFirstNamesEquivalent(firstA: string, firstB: string): boolean {
    const normA = cleanName(firstA).split(/\s+/)[0] ?? "";
    const normB = cleanName(firstB).split(/\s+/)[0] ?? "";

    if (!normA || !normB) return false;
    if (normA === normB) return true;
    if (normA.startsWith(normB) || normB.startsWith(normA)) return true;

    for (const group of NICKNAME_GROUPS) {
        if (group.includes(normA) && group.includes(normB)) return true;
    }
    return false;
}

function isNameMatch(
    firstA: string | null | undefined,
    lastA: string | null | undefined,
    firstB: string | null | undefined,
    lastB: string | null | undefined,
): boolean {
    if (!firstA || !lastA || !firstB || !lastB) return false;

    const normLastA = cleanName(lastA).split(/\s+/)[0] ?? "";
    const normLastB = cleanName(lastB).split(/\s+/)[0] ?? "";

    if (!normLastA || !normLastB || normLastA !== normLastB) return false;

    return areFirstNamesEquivalent(firstA, firstB);
}

async function crossCampaignEmailCache(params: {
    companyId: string | null;
    firstName: string | null;
    lastName: string | null;
    campaignId: string;
    currentLeadId: string;
    userId: string;
}): Promise<CachedEmailResult | null> {
    const { companyId, firstName, lastName, campaignId, currentLeadId, userId } = params;

    if (!companyId || !firstName || !lastName) return null;

    const freshnessCutoff = new Date(Date.now() - CROSS_CAMPAIGN_CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);

    const candidates = await prisma.lead.findMany({
        where: {
            companyId,
            emailStatus: EMAIL_STATUS.FOUND,
            email: { not: null },
            id: { not: currentLeadId },
            deletedAt: null,
            lastEnrichedAt: { gte: freshnessCutoff },
        },
        select: { firstName: true, lastName: true, email: true, emailCatchAll: true },
        orderBy: { lastEnrichedAt: "desc" },
        take: 20,
    });

    for (const candidate of candidates) {
        if (candidate.email && isNameMatch(firstName, lastName, candidate.firstName, candidate.lastName)) {
            const { blocked } = await isEmailBlockedForCampaign(candidate.email, campaignId, userId);
            if (!blocked) {
                return { email: candidate.email, catchAll: candidate.emailCatchAll };
            }
        }
    }

    return null;
}

async function revealEmailsViaApollo(apolloIds: string[]): Promise<Map<string, string>> {
    if (apolloIds.length === 0) return new Map();

    let key: string;
    try {
        key = await apolloEnrichVault.acquireKey();
    } catch (err) {
        logger.warn(
            { err: err instanceof Error ? err.message : String(err), apolloIdsCount: apolloIds.length },
            "[email-enrichment] revealEmailsViaApollo key acquisition failed — failing over to Hunter/Website/Waterfall pipeline",
        );
        return new Map();
    }

    const result = new Map<string, string>();
    let lastError: unknown;

    for (let attempt = 0; attempt <= APOLLO_REVEAL_MAX_RETRIES; attempt++) {
        if (attempt > 0) {
            await new Promise(r => setTimeout(r, APOLLO_RETRY_BASE_MS * 2 ** (attempt - 1)));
        }

        try {
            const res = await fetch("https://api.apollo.io/api/v1/people/bulk_match", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Api-Key": key,
                },
                body: JSON.stringify({
                    details: apolloIds.map(id => ({ id })),
                    reveal_personal_emails: false,
                    reveal_phone_number: false,
                }),
                signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS),
            });

            if (res.status === 429 || res.status === 401 || res.status === 402 || res.status === 403) {
                await apolloEnrichVault.reportFailure(key, res.status);
                try { key = await apolloEnrichVault.acquireKey(); } catch { return result; }
                const retryAfter = res.status === 429 ? Number(res.headers.get("retry-after") ?? 5) * 1000 : 0;
                if (retryAfter > 0) await new Promise(r => setTimeout(r, retryAfter));
                lastError = new Error(`Apollo key exhausted (${res.status})`);
                continue;
            }

            if (!res.ok) {
                lastError = new Error(`Apollo bulk_match HTTP ${res.status}`);
                continue;
            }

            const data = await res.json() as {
                matches?: Array<{ id?: string; email?: string }>;
            };

            for (const match of data.matches ?? []) {
                if (match.id && match.email && match.email.includes("@")) {
                    result.set(match.id, match.email.toLowerCase());
                }
            }

            return result;
        } catch (err) {
            lastError = err;
        }
    }

    logger.warn({ err: lastError, apolloIds }, "[email-enrichment] revealEmailsViaApollo exhausted retries");
    return result;
}

async function findEmailViaHunter(params: {
    domain: string;
    firstName: string;
    lastName: string;
}): Promise<{ email: string; verified: boolean } | null> {
    const { domain, firstName, lastName } = params;

    let key: string;
    try {
        key = await hunterVault.acquireKey();
    } catch {
        return null;
    }

    for (let attempt = 0; attempt < 3; attempt++) {
        const url = new URL("https://api.hunter.io/v2/email-finder");
        url.searchParams.set("domain", domain);
        url.searchParams.set("first_name", firstName);
        url.searchParams.set("last_name", lastName);
        url.searchParams.set("api_key", key);

        try {
            const res = await fetch(url.toString(), {
                signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS),
            });

            if (res.status === 404) return null;

            if (res.status === 429 || res.status === 401 || res.status === 402 || res.status === 403) {
                await hunterVault.reportFailure(key, res.status);
                try { key = await hunterVault.acquireKey(); } catch { return null; }
                continue;
            }

            if (!res.ok) {
                logger.warn({ status: res.status, domain }, "[email-enrichment] Hunter non-OK");
                return null;
            }

            const data = await res.json() as {
                data?: {
                    email?: string;
                    score?: number;
                    verification?: { status?: string };
                };
            };

            const email = data.data?.email;
            const score = data.data?.score ?? 0;

            if (!email || score < HUNTER_MIN_SCORE) return null;

            return {
                email,
                verified: data.data?.verification?.status === "valid",
            };
        } catch (err) {
            logger.warn({ err, domain }, "[email-enrichment] Hunter fetch failed");
            return null;
        }
    }

    return null;
}

async function verifyEmailZerobounce(email: string): Promise<EmailVerificationOutcome> {
    if (!process.env.ZEROBOUNCE_API_KEY) return { kind: "not_configured" };

    try {
        const res = await fetch(
            `https://api.zerobounce.net/v2/validate?api_key=${process.env.ZEROBOUNCE_API_KEY}&email=${encodeURIComponent(email)}&ip_address=`,
            { signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS) },
        );

        if (!res.ok) {
            logger.warn({ email, status: res.status }, "[email-enrichment] Zerobounce returned non-OK — transient failure");
            return { kind: "transient_failure", reason: `http_${res.status}` };
        }

        const data = await res.json() as { status?: string };

        if (!data.status) {
            logger.warn({ email }, "[email-enrichment] Zerobounce response missing status field — transient failure");
            return { kind: "transient_failure", reason: "malformed_response" };
        }

        if (ZEROBOUNCE_BLOCK_STATUSES.has(data.status)) return { kind: "blocked" };

        if (data.status === "catch-all") {
            return { kind: "verified", verified: false, catchAll: true };
        }

        return { kind: "verified", verified: data.status === "valid", catchAll: false };
    } catch (err) {
        logger.warn({ err, email }, "[email-enrichment] Zerobounce request failed — transient failure");
        return { kind: "transient_failure", reason: err instanceof Error ? err.message : "unknown_error" };
    }
}

const inFlightCompanyScrapes = new Map<string, Promise<void>>();

export async function scrapeAndPersistCompanyContext(
    leadId: string,
    website: string,
    forceRefresh = false,
): Promise<void> {
    const current = await prisma.lead.findUnique({
        where: { id: leadId },
        select: { companyId: true, enrichmentData: true },
    });

    if (!current?.companyId) return;
    const companyId = current.companyId;

    const alreadyRunning = inFlightCompanyScrapes.get(companyId);
    if (alreadyRunning) {
        await alreadyRunning;
        return;
    }

    const run = (async () => {
        const company = await prisma.company.findUnique({
            where: { id: companyId },
            select: { enrichmentData: true, lastEnrichedAt: true },
        });

        const existingCompanyData = readEnrichmentData(company?.enrichmentData);
        const isFresh =
            !forceRefresh &&
            !!company?.lastEnrichedAt &&
            Date.now() - company.lastEnrichedAt.getTime() < COMPANY_CONTEXT_FRESHNESS_MS &&
            Array.isArray(existingCompanyData.scrapedPages);

        if (!isFresh) {
            const { scrapeSubpages } = await import("../../lib/scrape");
            const pages = await scrapeSubpages(website);

            if (pages.length > 0) {
                await prisma.company.update({
                    where: { id: companyId },
                    data: {
                        enrichmentData: {
                            ...existingCompanyData,
                            scrapedPages: pages as unknown as Prisma.InputJsonValue,
                            scrapedAt: new Date().toISOString(),
                        },
                        lastEnrichedAt: new Date(),
                    },
                });
            }
        }

        const existingLeadData = readEnrichmentData(current.enrichmentData);
        const domain = extractDomain(existingLeadData, website);
        if (domain) {
            await populateTechSignals([{ companyId, domain }]).catch(() => null);
        }
    })();

    inFlightCompanyScrapes.set(companyId, run);
    try {
        await run;
    } finally {
        inFlightCompanyScrapes.delete(companyId);
    }
}

export async function forceReenrichLead(leadId: string): Promise<void> {
    const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        select: { id: true, website: true, companyId: true },
    });

    if (!lead) return;

    await prisma.lead.update({
        where: { id: leadId },
        data: {
            emailStatus: EMAIL_STATUS.NOT_ATTEMPTED,
            lastEnrichedAt: null,
        },
    });

    if (lead.website) {
        await scrapeAndPersistCompanyContext(leadId, lead.website, true).catch(() => { });
    }

    await runEmailEnrichmentAgent(leadId);
}

async function hydrateLeadFromLinkedIn(lead: {
    id: string;
    linkedinUrl: string | null;
    firstName: string | null;
    lastName: string | null;
    campaignId: string;
}): Promise<boolean> {
    if (!lead.linkedinUrl || (lead.firstName && lead.lastName)) return false;

    try {
        const linkedin = await createLinkedInProvider(lead.campaignId);
        if (!linkedin) return false;

        logger.info({ leadId: lead.id, linkedinUrl: lead.linkedinUrl }, "[email-enrichment] Attempting LinkedIn profile hydration");

        const profile = await linkedin.provider.getProfile(linkedin.account, { profileUrl: lead.linkedinUrl });
        if (!profile) return false;

        const updateData: Record<string, string> = {};
        if (!lead.firstName && profile.firstName) {
            updateData.firstName = profile.firstName;
            lead.firstName = profile.firstName;
        }
        if (!lead.lastName && profile.lastName) {
            updateData.lastName = profile.lastName;
            lead.lastName = profile.lastName;
        }
        if (profile.title) {
            updateData.title = profile.title;
        }

        if (Object.keys(updateData).length === 0) return false;

        await prisma.lead.update({ where: { id: lead.id }, data: updateData });
        logger.info({ leadId: lead.id, updateData }, "[email-enrichment] Hydrated lead fields from LinkedIn profile");
        return true;
    } catch (err) {
        logger.warn(
            { leadId: lead.id, err: err instanceof Error ? err.message : String(err) },
            "[email-enrichment] LinkedIn profile hydration failed",
        );
        return false;
    }
}

function isBlockedByMap(
    email: string,
    userId: string,
    suppressionMap: Map<string, { emails: Set<string>; domains: Set<string> }>,
    existingEmailByCampaign: Map<string, Set<string>>,
    campaignId: string,
): { blocked: boolean; reason: string } {
    const domain = email.split("@")[1] ?? "";
    const sets = suppressionMap.get(userId);
    if (sets) {
        if (sets.emails.has(email)) return { blocked: true, reason: "suppressed email" };
        if (sets.domains.has(domain)) return { blocked: true, reason: "suppressed domain" };
    }
    if (existingEmailByCampaign.get(campaignId)?.has(email)) {
        return { blocked: true, reason: "email already in campaign" };
    }
    return { blocked: false, reason: "" };
}

function registerFoundEmail(
    email: string,
    campaignId: string,
    existingEmailByCampaign: Map<string, Set<string>>,
): void {
    if (!existingEmailByCampaign.has(campaignId)) {
        existingEmailByCampaign.set(campaignId, new Set());
    }
    existingEmailByCampaign.get(campaignId)!.add(email);
}

async function isEmailBlockedForCampaign(
    email: string,
    campaignId: string,
    userId: string,
): Promise<{ blocked: boolean; reason: string }> {
    const domain = email.split("@")[1];

    const [suppression, existingLead] = await Promise.all([
        prisma.suppression.findFirst({
            where: { userId, OR: [{ email }, { domain }] },
            select: { email: true, domain: true },
        }),
        prisma.lead.findFirst({
            where: { campaignId, email, deletedAt: null },
            select: { id: true },
        }),
    ]);

    if (suppression) {
        return { blocked: true, reason: suppression.email ? "suppressed email" : "suppressed domain" };
    }
    if (existingLead) {
        return { blocked: true, reason: "email already in campaign" };
    }

    return { blocked: false, reason: "" };
}

async function maybeScheduleGenerate(campaignId: string): Promise<void> {
    const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { status: true },
    });

    if (campaign?.status === "GENERATING") {
        await emailGenerationQueue.add(
            "run-generate",
            { campaignId },
            { jobId: `run-generate-${campaignId}-enriched`, delay: 5_000 },
        );
    }
}

async function saveFoundEmail(params: {
    leadId: string;
    email: string;
    source: EmailSource;
    verified: boolean;
    catchAll: boolean;
    campaignId: string;
    expectedCurrentStatus?: EmailStatus;
}): Promise<void> {
    const {
        leadId,
        email,
        source,
        verified,
        catchAll,
        campaignId,
        expectedCurrentStatus = EMAIL_STATUS.PENDING,
    } = params;

    const updated = await prisma.lead.updateMany({
        where: { id: leadId, emailStatus: expectedCurrentStatus },
        data: {
            email,
            emailStatus: EMAIL_STATUS.FOUND,
            emailSource: source,
            emailVerified: verified,
            emailCatchAll: catchAll,
            lastEnrichedAt: new Date(),
        },
    });

    if (updated.count === 0) {
        logger.warn(
            { leadId, expectedCurrentStatus },
            "[email-enrichment] saveFoundEmail: lead no longer in expected status — skipping write (race condition guard)",
        );
        return;
    }

    emitCampaignEvent({
        campaignId,
        type: "progress",
        jobName: "emailEnrichment",
        label: "Email Enrichment",
        detail: `Verified email discovered`,
    });

    await maybeScheduleGenerate(campaignId);
}

async function markEmailNotFound(leadId: string, expectedCurrentStatus: EmailStatus): Promise<void> {
    const updated = await prisma.lead.updateMany({
        where: { id: leadId, emailStatus: expectedCurrentStatus },
        data: { emailStatus: EMAIL_STATUS.NOT_FOUND, lastEnrichedAt: new Date() },
    });
    if (updated.count === 0) {
        logger.warn(
            { leadId, expectedCurrentStatus },
            "[email-enrichment] markEmailNotFound: lead status changed concurrently — skipping write",
        );
    }
}

async function scheduleVerificationRetry(leadId: string, retryCount: number): Promise<void> {
    const delay = Math.min(
        VERIFICATION_RETRY_BASE_DELAY_MS * 2 ** (retryCount - 1),
        VERIFICATION_RETRY_MAX_DELAY_MS,
    );

    await emailEnrichmentQueue.add(
        "verify-retry",
        { type: "single", leadId },
        {
            jobId: `verify-retry-${leadId}-attempt-${retryCount}`,
            delay,
            attempts: 1,
        },
    );

    logger.info({ leadId, retryCount, delayMs: delay }, "[email-enrichment] Scheduled Zerobounce verification retry");
}

async function markPendingVerification(params: {
    leadId: string;
    email: string;
    source: EmailSource;
    campaignId: string;
    reason: string;
    expectedCurrentStatus?: EmailStatus;
}): Promise<void> {
    const {
        leadId,
        email,
        source,
        campaignId,
        reason,
        expectedCurrentStatus = EMAIL_STATUS.PENDING,
    } = params;

    const current = await prisma.lead.findUnique({ where: { id: leadId }, select: { enrichmentData: true } });
    const existing = readEnrichmentData(current?.enrichmentData);
    const retryState = nextRetryState(existing, reason);

    const updated = await prisma.lead.updateMany({
        where: { id: leadId, emailStatus: expectedCurrentStatus },
        data: {
            email,
            emailStatus: EMAIL_STATUS.PENDING_VERIFICATION,
            emailSource: source,
            emailVerified: false,
            emailCatchAll: false,
            lastEnrichedAt: new Date(),
            enrichmentData: { ...existing, emailVerification: retryState } as Prisma.InputJsonValue,
        },
    });

    if (updated.count === 0) {
        logger.warn({ leadId }, "[email-enrichment] markPendingVerification: lead no longer in expected status — skipping write");
        return;
    }

    if (retryState.exhausted) {
        logger.error(
            { leadId, email, campaignId, retryCount: retryState.retryCount },
            "[email-enrichment] Zerobounce verification retries exhausted — left in PENDING_VERIFICATION for manual review",
        );
        return;
    }

    logger.warn(
        { leadId, email, reason, campaignId },
        "[email-enrichment] Zerobounce unavailable — candidate email saved as PENDING_VERIFICATION, retry scheduled",
    );
    await scheduleVerificationRetry(leadId, retryState.retryCount);
}

async function hasValidMxRecord(email: string): Promise<"VALID" | "INVALID" | "TRANSIENT_ERROR"> {
    const domain = email.split("@")[1];
    if (!domain) return "INVALID";
    try {
        const records = await dns.promises.resolveMx(domain);
        return records && records.length > 0 ? "VALID" : "INVALID";
    } catch (err: unknown) {
        const errorCode = err && typeof err === "object" && "code" in err && typeof (err as { code?: unknown }).code === "string"
            ? (err as { code: string }).code
            : undefined;
        if (errorCode === "ENOTFOUND" || errorCode === "ENODATA") {
            return "INVALID";
        }
        return "TRANSIENT_ERROR";
    }
}

export function shouldAttemptPaidVerification(params: {
    qualificationScore?: number | null;
    recommendedAction?: string | null;
}): boolean {
    const score = typeof params.qualificationScore === "number" ? params.qualificationScore : 0;
    const action = params.recommendedAction ?? "";

    if (score >= PAID_VERIFICATION_MIN_SCORE) return true;
    if (action === "HIGH_PRIORITY" && score >= PAID_VERIFICATION_MIN_ACTION_SCORE) return true;
    return false;
}

async function resolveAndSaveEmail(params: {
    leadId: string;
    email: string;
    source: EmailSource;
    campaignId: string;
    expectedCurrentStatus?: EmailStatus;
    qualificationScore?: number | null;
    recommendedAction?: string | null;
}): Promise<void> {
    const {
        leadId,
        email,
        source,
        campaignId,
        expectedCurrentStatus = EMAIL_STATUS.PENDING,
        qualificationScore,
        recommendedAction,
    } = params;

    if (!process.env.ZEROBOUNCE_API_KEY || !shouldAttemptPaidVerification({ qualificationScore, recommendedAction })) {
        const mxStatus = await hasValidMxRecord(email);
        if (mxStatus === "INVALID") {
            await markEmailNotFound(leadId, expectedCurrentStatus);
            return;
        }
        if (mxStatus === "TRANSIENT_ERROR") {
            await markPendingVerification({ leadId, email, source, campaignId, reason: "transient_dns_failure", expectedCurrentStatus });
            return;
        }
        await saveFoundEmail({
            leadId,
            email,
            source,
            verified: false,
            catchAll: false,
            campaignId,
            expectedCurrentStatus,
        });
        return;
    }

    const current = await prisma.lead.findUnique({ where: { id: leadId }, select: { enrichmentData: true } });
    const existing = readEnrichmentData(current?.enrichmentData);
    const retryState = {
        retryCount: 0,
        lastFailureReason: "initial_async_verification",
        firstFailedAt: new Date().toISOString(),
        lastAttemptAt: new Date().toISOString(),
        exhausted: false,
    };

    const updated = await prisma.lead.updateMany({
        where: { id: leadId, emailStatus: expectedCurrentStatus },
        data: {
            email,
            emailStatus: EMAIL_STATUS.PENDING_VERIFICATION,
            emailSource: source,
            emailVerified: false,
            emailCatchAll: false,
            lastEnrichedAt: new Date(),
            enrichmentData: { ...existing, emailVerification: retryState } as Prisma.InputJsonValue,
        },
    });

    if (updated.count > 0) {
        await emailEnrichmentQueue.add(
            "verify-retry",
            { type: "single", leadId },
            {
                jobId: `verify-first-${leadId}`,
                delay: 0,
                attempts: 1,
            },
        );
    }
}

export async function retryEmailVerification(leadId: string): Promise<void> {
    const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        select: {
            email: true,
            emailStatus: true,
            emailSource: true,
            campaignId: true,
            enrichmentData: true,
        },
    });

    if (!lead) {
        logger.warn({ leadId }, "[email-enrichment] retryEmailVerification: lead not found — skipping");
        return;
    }

    if (lead.emailStatus !== EMAIL_STATUS.PENDING_VERIFICATION || !lead.email) {
        logger.info(
            { leadId, emailStatus: lead.emailStatus },
            "[email-enrichment] retryEmailVerification: no longer PENDING_VERIFICATION — skipping (resolved elsewhere or duplicate retry job)",
        );
        return;
    }

    const claimed = await prisma.lead.updateMany({
        where: {
            id: leadId,
            emailStatus: EMAIL_STATUS.PENDING_VERIFICATION,
        },
        data: { emailStatus: EMAIL_STATUS.PENDING },
    });

    if (claimed.count === 0) {
        logger.info({ leadId }, "[email-enrichment] retryEmailVerification: lost verification claim race — skipping");
        return;
    }

    const outcome = await verifyEmailZerobounce(lead.email);

    switch (outcome.kind) {
        case "blocked":
            await markEmailNotFound(leadId, EMAIL_STATUS.PENDING);
            logger.info({ leadId }, "[email-enrichment] retryEmailVerification: blocked on retry — marked NOT_FOUND");
            return;

        case "transient_failure": {
            const existing = readEnrichmentData(lead.enrichmentData);
            const retryState = nextRetryState(existing, outcome.reason);

            await prisma.lead.updateMany({
                where: { id: leadId, emailStatus: EMAIL_STATUS.PENDING },
                data: {
                    emailStatus: EMAIL_STATUS.PENDING_VERIFICATION,
                    lastEnrichedAt: new Date(),
                    enrichmentData: { ...existing, emailVerification: retryState } as Prisma.InputJsonValue,
                },
            });

            if (retryState.exhausted) {
                logger.error(
                    { leadId, retryCount: retryState.retryCount },
                    "[email-enrichment] retryEmailVerification: retries exhausted — left in PENDING_VERIFICATION for manual review",
                );
                return;
            }

            await scheduleVerificationRetry(leadId, retryState.retryCount);
            return;
        }

        case "not_configured":
            const hasMx = await hasValidMxRecord(lead.email);
            if (!hasMx) {
                await markEmailNotFound(leadId, EMAIL_STATUS.PENDING);
                return;
            }
            await saveFoundEmail({
                leadId,
                email: lead.email,
                source: (lead.emailSource as EmailSource) ?? EMAIL_SOURCE.APOLLO_SEARCH,
                verified: false,
                catchAll: false,
                campaignId: lead.campaignId,
                expectedCurrentStatus: EMAIL_STATUS.PENDING,
            });
            logger.info({ leadId }, "[email-enrichment] retryEmailVerification: ZB key gone — saved unverified");
            await maybeScheduleGenerate(lead.campaignId);
            return;

        case "verified":
            await saveFoundEmail({
                leadId,
                email: lead.email,
                source: (lead.emailSource as EmailSource) ?? EMAIL_SOURCE.APOLLO_SEARCH,
                verified: outcome.verified,
                catchAll: outcome.catchAll,
                campaignId: lead.campaignId,
                expectedCurrentStatus: EMAIL_STATUS.PENDING,
            });
            logger.info({ leadId }, "[email-enrichment] retryEmailVerification: verification succeeded on retry — promoted to FOUND");
            await maybeScheduleGenerate(lead.campaignId);
            return;
    }
}

// ─── Shared Email Resolution Core ───────────────────────────────────────────
// Both single-lead and batch paths delegate here.  Strategy differences
// (DB vs map-based suppression, per-lead vs pre-fetched Apollo, etc.)
// are injected via EmailResolutionContext.

export interface EmailResolutionContext {
    lead: {
        id: string;
        email: string | null;
        firstName: string | null;
        lastName: string | null;
        website: string | null;
        linkedinUrl: string | null;
        enrichmentData: unknown;
        externalId: string | null;
        companyId: string | null;
        campaignId: string;
        qualificationScore: number | null;
        recommendedAction: string | null;
    };
    userId: string;
    /** Check whether an email is blocked (suppression / already in campaign). */
    checkSuppression: (email: string) => Promise<{ blocked: boolean; reason: string }>;
    /** Pre-resolved Apollo reveal email (batch pre-fetches in bulk). */
    apolloRevealEmail?: string | null;
    /** Whether to call Apollo Reveal per-lead (true for single path, false for batch). */
    shouldCallApolloReveal?: boolean;
    /** Callback when an email is found — batch path uses this for in-flight dedup. */
    onEmailFound?: (email: string) => void;
    /** Whether campaign budget for paid providers is exhausted. */
    budgetExhausted?: boolean;
}

async function resolveEmailForOneLead(ctx: EmailResolutionContext): Promise<void> {
    const { lead, userId, checkSuppression, onEmailFound, budgetExhausted } = ctx;
    const leadDomain = extractDomain(lead.enrichmentData, lead.website);

    // ── Step 1: Existing email ──
    if (lead.email) {
        const normalised = lead.email.toLowerCase();
        const { blocked } = await checkSuppression(normalised);

        if (!blocked) {
            onEmailFound?.(normalised);
            await resolveAndSaveEmail({
                leadId: lead.id,
                email: normalised,
                source: EMAIL_SOURCE.APOLLO_SEARCH,
                campaignId: lead.campaignId,
                qualificationScore: lead.qualificationScore,
                recommendedAction: lead.recommendedAction,
            });
            await cacheResolvedEmail({
                companyId: lead.companyId,
                firstName: lead.firstName,
                lastName: lead.lastName,
                domain: leadDomain,
                email: normalised,
                resolution: {
                    email: normalised,
                    source: EMAIL_SOURCE.APOLLO_SEARCH,
                    verified: false,
                    catchAll: false,
                },
            });
            return;
        }
    }

    // ── Step 2: Apollo Reveal ──
    let revealedEmail: string | undefined;

    if (ctx.apolloRevealEmail) {
        revealedEmail = ctx.apolloRevealEmail;
    } else if (ctx.shouldCallApolloReveal && lead.externalId && !budgetExhausted) {
        const revealMap = await revealEmailsViaApollo([lead.externalId]);
        revealedEmail = revealMap.get(lead.externalId);
        if (revealedEmail) {
            recordEnrichmentCost({
                leadId: lead.id,
                campaignId: lead.campaignId,
                provider: "APOLLO_REVEAL",
                operation: "email_reveal",
            }).catch(() => null);
        }
    }

    if (revealedEmail) {
        const normalised = revealedEmail.toLowerCase();
        const { blocked } = await checkSuppression(normalised);

        if (!blocked) {
            onEmailFound?.(normalised);
            await resolveAndSaveEmail({
                leadId: lead.id,
                email: normalised,
                source: EMAIL_SOURCE.APOLLO_REVEAL,
                campaignId: lead.campaignId,
                qualificationScore: lead.qualificationScore,
                recommendedAction: lead.recommendedAction,
            });
            await cacheResolvedEmail({
                companyId: lead.companyId,
                firstName: lead.firstName,
                lastName: lead.lastName,
                domain: leadDomain,
                email: normalised,
                resolution: {
                    email: normalised,
                    source: EMAIL_SOURCE.APOLLO_REVEAL,
                    verified: false,
                    catchAll: false,
                },
            });
            return;
        }
    }

    // ── Step 3: Website discovery ──
    if (lead.website && lead.firstName && lead.lastName) {
        const discovery = await discoverDomainEmails(lead.website);
        const match = matchLeadToDiscovery(discovery, lead.firstName, lead.lastName);

        if (match) {
            const { blocked } = await checkSuppression(match.email);
            if (!blocked) {
                onEmailFound?.(match.email);
                const source = match.kind === "direct" ? EMAIL_SOURCE.WEBSITE_DIRECT : EMAIL_SOURCE.WEBSITE_PATTERN;
                logger.info({ leadId: lead.id, kind: match.kind }, "[email-enrichment] Email resolved from company website");
                await resolveAndSaveEmail({
                    leadId: lead.id,
                    email: match.email,
                    source,
                    campaignId: lead.campaignId,
                    qualificationScore: lead.qualificationScore,
                    recommendedAction: lead.recommendedAction,
                });
                await cacheResolvedEmail({
                    companyId: lead.companyId,
                    firstName: lead.firstName,
                    lastName: lead.lastName,
                    domain: leadDomain,
                    email: match.email,
                    resolution: {
                        email: match.email,
                        source,
                        verified: false,
                        catchAll: false,
                    },
                });
                return;
            }
        }
    }

    // ── Step 4: LinkedIn hydration (ensure we have names for Hunter) ──
    await hydrateLeadFromLinkedIn({
        id: lead.id,
        linkedinUrl: lead.linkedinUrl,
        firstName: lead.firstName,
        lastName: lead.lastName,
        campaignId: lead.campaignId,
    });

    // ── Step 5: Hunter ──
    const domain = extractDomain(lead.enrichmentData, lead.website);

    if (!domain) {
        logger.warn({ leadId: lead.id }, "[email-enrichment] No domain resolvable — skipping Hunter");
        await markEmailNotFound(lead.id, EMAIL_STATUS.PENDING);
        return;
    }

    if (!budgetExhausted) {
        const hunterFirstName = lead.firstName ?? "";
        const hunterLastName = lead.lastName ?? "";
        const hunterResult = await findEmailViaHunter({
            domain,
            firstName: hunterFirstName,
            lastName: hunterLastName,
        });

        if (hunterResult) {
            recordEnrichmentCost({
                leadId: lead.id,
                campaignId: lead.campaignId,
                provider: "HUNTER",
                operation: "email_reveal",
            }).catch(() => null);

            const normalised = hunterResult.email.toLowerCase();
            const { blocked } = await checkSuppression(normalised);

            if (!blocked) {
                onEmailFound?.(normalised);
                if (hunterResult.verified) {
                    await saveFoundEmail({
                        leadId: lead.id,
                        email: normalised,
                        source: EMAIL_SOURCE.HUNTER,
                        verified: true,
                        catchAll: false,
                        campaignId: lead.campaignId,
                    });
                } else {
                    await resolveAndSaveEmail({
                        leadId: lead.id,
                        email: normalised,
                        source: EMAIL_SOURCE.HUNTER,
                        campaignId: lead.campaignId,
                        qualificationScore: lead.qualificationScore,
                        recommendedAction: lead.recommendedAction,
                    });
                }
                await cacheResolvedEmail({
                    companyId: lead.companyId,
                    firstName: lead.firstName,
                    lastName: lead.lastName,
                    domain,
                    email: normalised,
                    resolution: {
                        email: normalised,
                        source: EMAIL_SOURCE.HUNTER,
                        verified: hunterResult.verified,
                        catchAll: false,
                    },
                });
                return;
            }
        }
    }

    // ── Step 6: Person waterfall fallback ──
    const excludeProviders = budgetExhausted
        ? ["Apollo", "PDL", "Hunter", "Crunchbase", "ApifyLinkedIn", "Proxycurl"]
        : undefined;

    const waterfallResult = await enrichPersonWaterfall(
        {
            email: lead.email ?? undefined,
            linkedinUrl: lead.linkedinUrl ?? undefined,
            firstName: lead.firstName ?? undefined,
            lastName: lead.lastName ?? undefined,
            domain,
        },
        {
            excludeProviders,
            onProviderSuccess: (providerName) => {
                recordEnrichmentCost({
                    leadId: lead.id,
                    campaignId: lead.campaignId,
                    provider: providerName.toUpperCase(),
                    operation: "person_enrichment",
                }).catch(() => null);
            },
        },
    );

    if (waterfallResult?.email) {
        const normalised = waterfallResult.email.toLowerCase();
        const { blocked } = await checkSuppression(normalised);

        if (!blocked) {
            onEmailFound?.(normalised);
            await resolveAndSaveEmail({
                leadId: lead.id,
                email: normalised,
                source: EMAIL_SOURCE.WATERFALL,
                campaignId: lead.campaignId,
                qualificationScore: lead.qualificationScore,
                recommendedAction: lead.recommendedAction,
            });
            await cacheResolvedEmail({
                companyId: lead.companyId,
                firstName: lead.firstName,
                lastName: lead.lastName,
                domain,
                email: normalised,
                resolution: {
                    email: normalised,
                    source: EMAIL_SOURCE.WATERFALL,
                    verified: false,
                    catchAll: false,
                },
            });
            return;
        }
    }

    // ── Step 7: Exhausted ──
    await markEmailNotFound(lead.id, EMAIL_STATUS.PENDING);
    logger.info({ leadId: lead.id }, "[email-enrichment] Enrichment exhausted — marked NOT_FOUND");
}

export async function runEmailEnrichmentAgent(leadId: string): Promise<void> {
    assertEnv();

    const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        select: {
            id: true,
            campaignId: true,
            email: true,
            emailStatus: true,
            firstName: true,
            lastName: true,
            companyName: true,
            website: true,
            linkedinUrl: true,
            enrichmentData: true,
            externalId: true,
            companyId: true,
            recommendedAction: true,
            qualificationScore: true,
            campaign: { select: { createdById: true } },
        },
    });

    if (!lead) {
        logger.warn({ leadId }, "[email-enrichment] Lead not found — skipping");
        return;
    }

    if (lead.recommendedAction === "DISQUALIFY") {
        logger.info({ leadId }, "[email-enrichment] Lead is DISQUALIFY — skipping enrichment");
        return;
    }

    const userId = lead.campaign.createdById;

    if (lead.emailStatus === EMAIL_STATUS.FOUND || lead.emailStatus === EMAIL_STATUS.NOT_FOUND) {
        logger.info({ leadId, emailStatus: lead.emailStatus }, "[email-enrichment] Already resolved — skipping");
        return;
    }

    const shouldProcess = await prisma.$transaction(async (tx) => {
        try {
            const locked = await acquireLeadLock(tx, leadId);
            if (locked.emailStatus !== EMAIL_STATUS.NOT_ATTEMPTED) {
                return false;
            }
            await tx.lead.update({
                where: { id: leadId },
                data: { emailStatus: EMAIL_STATUS.PENDING },
            });
            return true;
        } catch {
            return false;
        }
    });

    if (!shouldProcess) {
        logger.info({ leadId }, "[email-enrichment] Lost claim race — another worker is handling this lead");
        return;
    }

    lead.emailStatus = EMAIL_STATUS.PENDING;

    logger.info({ leadId }, "[email-enrichment] Starting email enrichment");

    const leadDomain = extractDomain(lead.enrichmentData, lead.website);
    if (leadDomain) {
        const domainSuppressed = await prisma.suppression.findFirst({
            where: { userId, domain: leadDomain },
            select: { id: true },
        });
        if (domainSuppressed) {
            logger.info({ leadId, leadDomain }, "[email-enrichment] Lead domain is suppressed — skipping enrichment");
            await prisma.lead.update({
                where: { id: leadId },
                data: { emailStatus: EMAIL_STATUS.NOT_FOUND, lastEnrichedAt: new Date() },
            });
            return;
        }
    }

    if (!lead.website && lead.companyName) {
        const discovered = await discoverWebsiteViaSerp(lead.companyName);
        if (discovered) {
            lead.website = discovered;
            await prisma.lead.update({
                where: { id: leadId },
                data: { website: discovered },
            }).catch(() => null);
            logger.info({ leadId, discovered }, "[email-enrichment] Website discovered via SERP");
        }
    }

    if (lead.website && lead.companyId) {
        await enqueueCompanyScrape({ leadId, companyId: lead.companyId, website: lead.website });
    }

    const cachedResult = await crossCampaignEmailCache({
        companyId: lead.companyId,
        firstName: lead.firstName,
        lastName: lead.lastName,
        campaignId: lead.campaignId,
        currentLeadId: leadId,
        userId,
    });

    if (cachedResult) {
        logger.info({ leadId }, "[email-enrichment] Email resolved from cross-campaign cache");
        await saveFoundEmail({
            leadId,
            email: cachedResult.email,
            source: EMAIL_SOURCE.CAMPAIGN_CACHE,
            verified: true,
            catchAll: cachedResult.catchAll,
            campaignId: lead.campaignId,
        });
        await cacheResolvedEmail({
            companyId: lead.companyId,
            firstName: lead.firstName,
            lastName: lead.lastName,
            domain: leadDomain,
            email: cachedResult.email,
            resolution: {
                email: cachedResult.email,
                source: EMAIL_SOURCE.CAMPAIGN_CACHE,
                verified: true,
                catchAll: cachedResult.catchAll,
            },
        });
        return;
    }

    const cachedResolution = await maybeResolveFromEnrichmentCache({
        companyId: lead.companyId,
        firstName: lead.firstName,
        lastName: lead.lastName,
        domain: leadDomain,
        email: lead.email,
    });

    if (cachedResolution) {
        logger.info({ leadId, email: cachedResolution.email }, "[email-enrichment] Resolved from cache");
        await saveFoundEmail({
            leadId,
            email: cachedResolution.email,
            source: cachedResolution.source as EmailSource,
            verified: cachedResolution.verified,
            catchAll: cachedResolution.catchAll,
            campaignId: lead.campaignId,
        });
        return;
    }

    // ── Delegate to shared email resolution core ──
    const budgetExhausted = await isCampaignBudgetExhausted(lead.campaignId);

    await resolveEmailForOneLead({
        lead,
        userId,
        checkSuppression: (email) => isEmailBlockedForCampaign(email, lead.campaignId, userId),
        shouldCallApolloReveal: true,
        budgetExhausted,
    });
}

export async function runBatchEmailEnrichmentAgent(leadIds: string[]): Promise<void> {
    assertEnv();

    const leads = await prisma.lead.findMany({
        where: {
            id: { in: leadIds },
            emailStatus: EMAIL_STATUS.NOT_ATTEMPTED,
            recommendedAction: { not: "DISQUALIFY" },
        },
        select: {
            id: true,
            campaignId: true,
            email: true,
            emailStatus: true,
            firstName: true,
            lastName: true,
            website: true,
            linkedinUrl: true,
            enrichmentData: true,
            externalId: true,
            companyId: true,
            recommendedAction: true,
            qualificationScore: true,
            campaign: { select: { createdById: true } },
        },
    });

    if (leads.length === 0) return;

    const campaignId = leads[0]?.campaignId;
    if (campaignId) {
        emitCampaignEvent({
            campaignId,
            type: "active",
            jobName: "emailEnrichment",
            label: "Email Enrichment",
            detail: `Enriching ${leads.length} leads`,
        });
    }

    const candidateIds = leads.map(l => l.id);

    const claimedRows = await prisma.$queryRaw<{ id: string }[]>`
        UPDATE "Lead"
        SET    "emailStatus" = 'PENDING'::"EmailStatus"
        WHERE  id = ANY(${candidateIds}::text[])
          AND  "emailStatus" = 'NOT_ATTEMPTED'::"EmailStatus"
          AND  "recommendedAction" != 'DISQUALIFY'
        RETURNING id
    `;

    const claimedIds = new Set(claimedRows.map(r => r.id));
    const claimedLeads = leads.filter(l => claimedIds.has(l.id));

    if (claimedLeads.length === 0) return;

    for (const lead of claimedLeads) {
        lead.emailStatus = EMAIL_STATUS.PENDING;
    }

    const userIds = [...new Set(claimedLeads.map(l => l.campaign.createdById))];
    const suppressions = await prisma.suppression.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, email: true, domain: true },
    });

    const suppressionMap = new Map<string, { emails: Set<string>; domains: Set<string> }>();
    for (const sup of suppressions) {
        if (!sup.userId) continue;
        if (!suppressionMap.has(sup.userId)) {
            suppressionMap.set(sup.userId, { emails: new Set(), domains: new Set() });
        }
        const sets = suppressionMap.get(sup.userId)!;
        if (sup.email) sets.emails.add(sup.email.toLowerCase());
        if (sup.domain) sets.domains.add(sup.domain.toLowerCase());
    }

    const activeLeads: typeof claimedLeads = [];
    const suppressedLeadIds: string[] = [];

    for (const lead of claimedLeads) {
        const leadDomain = extractDomain(lead.enrichmentData, lead.website);
        const userId = lead.campaign.createdById;
        const sets = suppressionMap.get(userId);

        if (leadDomain && sets && sets.domains.has(leadDomain.toLowerCase())) {
            suppressedLeadIds.push(lead.id);
        } else {
            activeLeads.push(lead);
        }
    }

    if (suppressedLeadIds.length > 0) {
        await prisma.lead.updateMany({
            where: { id: { in: suppressedLeadIds } },
            data: { emailStatus: EMAIL_STATUS.NOT_FOUND, lastEnrichedAt: new Date() },
        });
        logger.info({ count: suppressedLeadIds.length }, "[email-enrichment] Batch: marked suppressed domains as NOT_FOUND");
    }

    if (activeLeads.length === 0) return;

    await enqueueCompanyScrapes(
        activeLeads
            .filter(lead => lead.website && lead.companyId)
            .map(lead => ({ leadId: lead.id, companyId: lead.companyId!, website: lead.website! })),
    );

    const cacheLimit = pLimit(5);
    const cacheResolved = new Set<string>();

    await Promise.all(
        activeLeads.map(lead =>
            cacheLimit(async () => {
                const userId = lead.campaign.createdById;
                const cachedResult = await crossCampaignEmailCache({
                    companyId: lead.companyId,
                    firstName: lead.firstName,
                    lastName: lead.lastName,
                    campaignId: lead.campaignId,
                    currentLeadId: lead.id,
                    userId,
                });
                if (cachedResult) {
                    logger.info({ leadId: lead.id }, "[email-enrichment] Batch: email resolved from cross-campaign cache");
                    await saveFoundEmail({
                        leadId: lead.id,
                        email: cachedResult.email,
                        source: EMAIL_SOURCE.CAMPAIGN_CACHE,
                        verified: true,
                        catchAll: cachedResult.catchAll,
                        campaignId: lead.campaignId,
                    });
                    cacheResolved.add(lead.id);
                    return;
                }

                const leadDomain = extractDomain(lead.enrichmentData, lead.website);
                const cachedResolution = await maybeResolveFromEnrichmentCache({
                    companyId: lead.companyId,
                    firstName: lead.firstName,
                    lastName: lead.lastName,
                    domain: leadDomain,
                    email: lead.email,
                });

                if (cachedResolution) {
                    logger.info({ leadId: lead.id, email: cachedResolution.email }, "[email-enrichment] Batch: email resolved from generic cache");
                    await saveFoundEmail({
                        leadId: lead.id,
                        email: cachedResolution.email,
                        source: cachedResolution.source as EmailSource,
                        verified: cachedResolution.verified,
                        catchAll: cachedResolution.catchAll,
                        campaignId: lead.campaignId,
                    });
                    cacheResolved.add(lead.id);
                    return;
                }
            }),
        ),
    );

    const remainingLeads = activeLeads.filter(l => !cacheResolved.has(l.id));

    if (remainingLeads.length === 0) return;

    const campaignIds = [...new Set(remainingLeads.map(l => l.campaignId))];
    const existingEmailRows = await prisma.lead.findMany({
        where: {
            campaignId: { in: campaignIds },
            email: { not: null },
            deletedAt: null,
        },
        select: { campaignId: true, email: true },
    });
    const existingEmailByCampaign = new Map<string, Set<string>>();
    for (const row of existingEmailRows) {
        if (!row.email) continue;
        if (!existingEmailByCampaign.has(row.campaignId)) {
            existingEmailByCampaign.set(row.campaignId, new Set());
        }
        existingEmailByCampaign.get(row.campaignId)!.add(row.email.toLowerCase());
    }

    // Check budget once per campaign for the batch
    const budgetCheckCache = new Map<string, boolean>();
    async function getBudgetExhausted(cId: string): Promise<boolean> {
        if (budgetCheckCache.has(cId)) return budgetCheckCache.get(cId)!;
        const exhausted = await isCampaignBudgetExhausted(cId);
        budgetCheckCache.set(cId, exhausted);
        return exhausted;
    }

    const apolloLeadsEligible: typeof remainingLeads = [];
    for (const lead of remainingLeads) {
        if (lead.externalId && !(await getBudgetExhausted(lead.campaignId))) {
            apolloLeadsEligible.push(lead);
        }
    }

    const apolloIdChunks: string[][] = [];

    for (let i = 0; i < apolloLeadsEligible.length; i += APOLLO_BULK_MATCH_SIZE) {
        apolloIdChunks.push(
            apolloLeadsEligible.slice(i, i + APOLLO_BULK_MATCH_SIZE).map(l => l.externalId!),
        );
    }

    const apolloEmailMap = new Map<string, string>();

    const apolloLimit = pLimit(3);
    const chunkResults = await Promise.all(
        apolloIdChunks.map(chunk => apolloLimit(() => revealEmailsViaApollo(chunk))),
    );
    for (const chunkResult of chunkResults) {
        for (const [id, email] of chunkResult) apolloEmailMap.set(id, email);
    }

    // Record Apollo Reveal cost for every lead that got a revealed email
    for (const lead of apolloLeadsEligible) {
        if (lead.externalId && apolloEmailMap.has(lead.externalId)) {
            recordEnrichmentCost({
                leadId: lead.id,
                campaignId: lead.campaignId,
                provider: "APOLLO_REVEAL",
                operation: "email_reveal",
            }).catch(() => null);
        }
    }

    async function processOneLead(lead: (typeof remainingLeads)[0]): Promise<void> {
        const leadUserId = lead.campaign.createdById;
        try {
            const budgetExhausted = await getBudgetExhausted(lead.campaignId);

            await resolveEmailForOneLead({
                lead,
                userId: leadUserId,
                checkSuppression: (email) =>
                    Promise.resolve(isBlockedByMap(email, leadUserId, suppressionMap, existingEmailByCampaign, lead.campaignId)),
                apolloRevealEmail: lead.externalId ? apolloEmailMap.get(lead.externalId) ?? null : null,
                shouldCallApolloReveal: false,  // batch pre-fetches Apollo in bulk above
                onEmailFound: (email) => registerFoundEmail(email, lead.campaignId, existingEmailByCampaign),
                budgetExhausted,
            });
        } catch (err) {
            logger.warn({ err, leadId: lead.id }, "[email-enrichment] Batch: lead failed — resetting to NOT_ATTEMPTED");
            await prisma.lead.updateMany({
                where: { id: lead.id, emailStatus: EMAIL_STATUS.PENDING },
                data: { emailStatus: EMAIL_STATUS.NOT_ATTEMPTED },
            }).catch((resetErr) =>
                logger.warn({ resetErr, leadId: lead.id }, "[email-enrichment] Batch: failed to reset lead status after error"),
            );
        }
    }

    const emailLimit = pLimit(5);
    await Promise.all(remainingLeads.map(lead => emailLimit(() => processOneLead(lead))));

    if (campaignId) {
        emitCampaignEvent({
            campaignId,
            type: "completed",
            jobName: "emailEnrichment",
            label: "Email Enrichment",
            detail: `Completed email enrichment pass`,
        });
    }
}