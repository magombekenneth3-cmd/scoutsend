import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { emailGenerationQueue } from "./campaign.queue";
import { emailEnrichmentQueue } from "./email-enrichment.queue";
import { createLinkedInProvider } from "../../lib/linkedIn";
import pLimit from "p-limit";
import { Prisma } from "@prisma/client";
import { enrichPersonWaterfall } from "../../lib/providers";
import dns from "dns";
import { ApiKeyVault } from "../../lib/key-manager";
import {
    buildEnrichmentCacheKey,
    getCachedEnrichmentValue,
    setCachedEnrichmentValue,
    type CachedEmailResolution,
} from "./enrichment-cache";

// ─── Constants ────────────────────────────────────────────────────────────────

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

const MAX_VERIFICATION_RETRIES = 5;
const VERIFICATION_RETRY_BASE_DELAY_MS = 10 * 60_000;
const VERIFICATION_RETRY_MAX_DELAY_MS = 6 * 60 * 60_000;

// ─── Status / Source enums ────────────────────────────────────────────────────

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
} as const;
export type EmailSource = (typeof EMAIL_SOURCE)[keyof typeof EMAIL_SOURCE];

// ─── Zerobounce discriminated union ──────────────────────────────────────────

/**
 * Every call site must explicitly handle all four outcomes:
 *
 *   "verified"          – Zerobounce responded; use verified + catchAll flags.
 *   "blocked"           – Address is on the block-list; treat as NOT_FOUND.
 *   "not_configured"    – ZEROBOUNCE_API_KEY absent; save unverified / skip.
 *   "transient_failure" – Network error or non-OK HTTP; schedule a retry.
 */
export type EmailVerificationOutcome =
    | { kind: "verified"; verified: boolean; catchAll: boolean }
    | { kind: "blocked" }
    | { kind: "not_configured" }
    | { kind: "transient_failure"; reason: string };

// ─── Internal types ────────────────────────────────────────────────────────────

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

// ─── Env guard ────────────────────────────────────────────────────────────────

function assertEnv(): void {
    const missing = (["APOLLO_API_KEYS", "HUNTER_API_KEYS"] as const).filter(k => !process.env[k]);
    if (missing.length > 0) {
        logger.warn({ missing }, "[email-enrichment] Missing optional env vars — some enrichment sources will be skipped");
    }
    if (!process.env.ZEROBOUNCE_API_KEY) {
        logger.warn(
            "[email-enrichment] ZEROBOUNCE_API_KEY not set — email verification is disabled; discovered emails will be saved unverified",
        );
    }
}

// ─── Domain extraction ────────────────────────────────────────────────────────

function extractDomain(enrichmentData: unknown, website: string | null | undefined): string | null {
    if (enrichmentData && typeof enrichmentData === "object") {
        const d = enrichmentData as Record<string, unknown>;
        if (typeof d.domain === "string" && d.domain) return d.domain;
    }
    if (website) {
        try {
            return new URL(website).hostname.replace(/^www\./, "");
        } catch {
            return null;
        }
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

// ─── enrichmentData helpers ───────────────────────────────────────────────────

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

// ─── Cross-campaign email cache ───────────────────────────────────────────────

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

    const sibling = await prisma.lead.findFirst({
        where: {
            companyId,
            firstName,
            lastName,
            emailStatus: EMAIL_STATUS.FOUND,
            email: { not: null },
            id: { not: currentLeadId },
            deletedAt: null,
            lastEnrichedAt: { gte: freshnessCutoff },
        },
        select: { email: true, emailCatchAll: true },
        orderBy: { lastEnrichedAt: "desc" },
    });

    if (!sibling?.email) return null;

    const { blocked } = await isEmailBlockedForCampaign(sibling.email, campaignId, userId);
    if (blocked) return null;

    return { email: sibling.email, catchAll: sibling.emailCatchAll };
}

// ─── Apollo reveal ────────────────────────────────────────────────────────────

async function revealEmailsViaApollo(apolloIds: string[]): Promise<Map<string, string>> {
    if (apolloIds.length === 0) return new Map();

    let key: string;
    try {
        key = await apolloEnrichVault.acquireKey();
    } catch {
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

// ─── Hunter ───────────────────────────────────────────────────────────────────

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


// ─── Zerobounce ───────────────────────────────────────────────────────────────

/**
 * Returns a discriminated union — never returns null.
 * Callers must switch on `outcome.kind` and handle every branch.
 */
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

// ─── Company context scraping ─────────────────────────────────────────────────

async function scrapeAndPersistCompanyContext(leadId: string, website: string): Promise<void> {
    const { scrapeCompanyText } = await import("../../lib/scrape");
    const text = await scrapeCompanyText(website);
    if (!text) return;

    const truncated = text.slice(0, 4_000);

    const current = await prisma.lead.findUnique({
        where: { id: leadId },
        select: { enrichmentData: true },
    });

    const existing = readEnrichmentData(current?.enrichmentData);

    await prisma.lead.update({
        where: { id: leadId },
        data: {
            enrichmentData: {
                ...existing,
                scrapedHomepageText: truncated,
                scrapedAt: new Date().toISOString(),
            },
        },
    });
}

// ─── LinkedIn profile hydration ───────────────────────────────────────────────

/**
 * Shared helper used by both single-lead and batch paths.
 * Mutates `lead.firstName` / `lead.lastName` in-place so downstream steps
 * can use the hydrated values without re-querying the DB.
 * Returns true if any fields were updated.
 */
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

// ─── Suppression helpers ──────────────────────────────────────────────────────

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

// ─── Campaign queue helper ────────────────────────────────────────────────────

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

// ─── DB write helpers ─────────────────────────────────────────────────────────

/**
 * Writes an email as FOUND.
 * `expectedCurrentStatus` must be passed so the guard works whether we're
 * promoting from PENDING (first-pass enrichment) or PENDING_VERIFICATION (retry).
 */
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

// ─── Pending-verification helpers ─────────────────────────────────────────────

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

// ─── Core verify-then-save ────────────────────────────────────────────────────

/**
 * FIX (section 3): Single canonical function that handles every Zerobounce
 * outcome. Previously inlined at every call site with stale null-check logic;
 * now all call sites use this function, keeping single-lead and retry paths
 * consistent.
 *
 * `expectedCurrentStatus` controls the optimistic-concurrency guard so the
 * same function works for both first-pass (PENDING) and retry (PENDING_VERIFICATION).
 */
async function hasValidMxRecord(email: string): Promise<boolean> {
    const domain = email.split("@")[1];
    if (!domain) return false;
    try {
        const records = await dns.promises.resolveMx(domain);
        return records && records.length > 0;
    } catch (err: unknown) {
        const errorCode = err && typeof err === "object" && "code" in err && typeof (err as { code?: unknown }).code === "string"
            ? (err as { code: string }).code
            : undefined;
        if (errorCode === "ENOTFOUND" || errorCode === "ENODATA") {
            return false;
        }
        return true;
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
        const hasMx = await hasValidMxRecord(email);
        if (!hasMx) {
            await markEmailNotFound(leadId, expectedCurrentStatus);
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

// ─── Public: retry verification for a PENDING_VERIFICATION lead ───────────────

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

    const outcome = await verifyEmailZerobounce(lead.email);

    switch (outcome.kind) {
        case "blocked":
            await markEmailNotFound(leadId, EMAIL_STATUS.PENDING_VERIFICATION);
            logger.info({ leadId }, "[email-enrichment] retryEmailVerification: blocked on retry — marked NOT_FOUND");
            return;

        case "transient_failure": {
            const existing = readEnrichmentData(lead.enrichmentData);
            const retryState = nextRetryState(existing, outcome.reason);

            await prisma.lead.updateMany({
                where: { id: leadId, emailStatus: EMAIL_STATUS.PENDING_VERIFICATION },
                data: {
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
                await markEmailNotFound(leadId, EMAIL_STATUS.PENDING_VERIFICATION);
                return;
            }
            await saveFoundEmail({
                leadId,
                email: lead.email,
                source: (lead.emailSource as EmailSource) ?? EMAIL_SOURCE.APOLLO_SEARCH,
                verified: false,
                catchAll: false,
                campaignId: lead.campaignId,
                expectedCurrentStatus: EMAIL_STATUS.PENDING_VERIFICATION,
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
                expectedCurrentStatus: EMAIL_STATUS.PENDING_VERIFICATION,
            });
            logger.info({ leadId }, "[email-enrichment] retryEmailVerification: verification succeeded on retry — promoted to FOUND");
            await maybeScheduleGenerate(lead.campaignId);
            return;
    }
}

// ─── Public: single-lead enrichment ──────────────────────────────────────────

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
        const locked = await tx.$queryRaw<Array<{ id: string; emailStatus: string }>>`
            SELECT id, "emailStatus" FROM "Lead" WHERE id = ${leadId} FOR UPDATE
        `;
        if (locked.length === 0 || locked[0].emailStatus !== EMAIL_STATUS.NOT_ATTEMPTED) {
            return false;
        }
        await tx.lead.update({
            where: { id: leadId },
            data: { emailStatus: EMAIL_STATUS.PENDING },
        });
        return true;
    });

    if (!shouldProcess) {
        logger.info({ leadId }, "[email-enrichment] Lost claim race — another worker is handling this lead");
        return;
    }

    // FIX (section 5): Reflect the claimed status in the in-memory object so
    // any downstream code that reads lead.emailStatus sees the correct value.
    lead.emailStatus = EMAIL_STATUS.PENDING;

    logger.info({ leadId }, "[email-enrichment] Starting email enrichment");

    // Domain-level suppression check before any API calls.
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

    // Scrape company homepage for downstream generation context.
    if (lead.website) {
        await scrapeAndPersistCompanyContext(leadId, lead.website).catch(() => { });
    }

    // ── Source 1: cross-campaign cache ──────────────────────────────────────
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

    if (lead.email) {
        const normalised = lead.email.toLowerCase();
        const { blocked } = await isEmailBlockedForCampaign(normalised, lead.campaignId, userId);

        if (!blocked) {
            await resolveAndSaveEmail({
                leadId,
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

    if (lead.externalId) {
        const revealMap = await revealEmailsViaApollo([lead.externalId]);
        const revealedEmail = revealMap.get(lead.externalId);

        if (revealedEmail) {
            const normalised = revealedEmail.toLowerCase();
            const { blocked } = await isEmailBlockedForCampaign(normalised, lead.campaignId, userId);

            if (!blocked) {
                await resolveAndSaveEmail({
                    leadId,
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
    }

    const domain = extractDomain(lead.enrichmentData, lead.website);

    if (!domain) {
        logger.warn({ leadId }, "[email-enrichment] No domain resolvable — skipping Hunter");
        await prisma.lead.update({
            where: { id: leadId },
            data: { emailStatus: EMAIL_STATUS.NOT_FOUND, lastEnrichedAt: new Date() },
        });
        return;
    }

    // ── Source 5: Hunter ─────────────────────────────────────────────────────
    const hunterFirstName = lead.firstName ?? "";
    const hunterLastName = lead.lastName ?? "";
    const hunterResult = await findEmailViaHunter({
        domain,
        firstName: hunterFirstName,
        lastName: hunterLastName,
    });

    if (hunterResult) {
        const normalised = hunterResult.email.toLowerCase();
        const { blocked } = await isEmailBlockedForCampaign(normalised, lead.campaignId, userId);

        if (!blocked) {
            await resolveAndSaveEmail({
                leadId,
                email: normalised,
                source: EMAIL_SOURCE.HUNTER,
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
                    source: EMAIL_SOURCE.HUNTER,
                    verified: false,
                    catchAll: false,
                },
            });
            return;
        }
    }

    const waterfallResult = await enrichPersonWaterfall({
        email: lead.email ?? undefined,
        linkedinUrl: lead.linkedinUrl ?? undefined,
        firstName: lead.firstName ?? undefined,
        lastName: lead.lastName ?? undefined,
        domain,
    });

    if (waterfallResult?.email) {
        const normalised = waterfallResult.email.toLowerCase();
        const { blocked } = await isEmailBlockedForCampaign(normalised, lead.campaignId, userId);

        if (!blocked) {
            await resolveAndSaveEmail({
                leadId,
                email: normalised,
                source: EMAIL_SOURCE.WATERFALL,
                campaignId: lead.campaignId,
                qualificationScore: lead.qualificationScore,
                recommendedAction: lead.recommendedAction,
            });
            return;
        }
    }

    await prisma.lead.update({
        where: { id: leadId },
        data: { emailStatus: EMAIL_STATUS.NOT_FOUND, lastEnrichedAt: new Date() },
    });

    logger.info({ leadId }, "[email-enrichment] Enrichment exhausted — marked NOT_FOUND");
}

// ─── Public: batch enrichment ─────────────────────────────────────────────────

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

    const candidateIds = leads.map(l => l.id);

    // Atomic batch-claim via raw SQL.
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

    // FIX (section 5): Reflect claimed status in memory for all claimed leads.
    for (const lead of claimedLeads) {
        lead.emailStatus = EMAIL_STATUS.PENDING;
    }

    // ── Build per-user suppression map ───────────────────────────────────────
    const userIds = [...new Set(claimedLeads.map(l => l.campaign.createdById))];
    const suppressions = await prisma.suppression.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, email: true, domain: true },
    });

    const suppressionMap = new Map<string, { emails: Set<string>; domains: Set<string> }>();
    for (const sup of suppressions) {
        if (!suppressionMap.has(sup.userId)) {
            suppressionMap.set(sup.userId, { emails: new Set(), domains: new Set() });
        }
        const sets = suppressionMap.get(sup.userId)!;
        if (sup.email) sets.emails.add(sup.email.toLowerCase());
        if (sup.domain) sets.domains.add(sup.domain.toLowerCase());
    }

    // ── Domain-level suppression filter ──────────────────────────────────────
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

    // ── Parallel company-context scraping ─────────────────────────────────────
    const scrapeLimit = pLimit(3);
    await Promise.all(
        activeLeads.map(lead =>
            scrapeLimit(async () => {
                if (lead.website) {
                    await scrapeAndPersistCompanyContext(lead.id, lead.website).catch(() => { });
                }
            }),
        ),
    );

    // FIX (section 4): Cross-campaign cache check in batch path.
    // We check per-lead; leads resolved here skip Apollo + Hunter spend.
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
                if (!cachedResult) return;

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
            }),
        ),
    );

    const remainingLeads = activeLeads.filter(l => !cacheResolved.has(l.id));

    if (remainingLeads.length === 0) return;

    // ── Pre-load existing campaign emails for duplicate detection ─────────────
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

    // ── Apollo bulk-reveal ────────────────────────────────────────────────────
    const apolloLeads = remainingLeads.filter(l => l.externalId);
    const apolloIdChunks: string[][] = [];

    for (let i = 0; i < apolloLeads.length; i += APOLLO_BULK_MATCH_SIZE) {
        apolloIdChunks.push(
            apolloLeads.slice(i, i + APOLLO_BULK_MATCH_SIZE).map(l => l.externalId!),
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

    // ── Per-lead processing ───────────────────────────────────────────────────
    async function processOneLead(lead: (typeof remainingLeads)[0]): Promise<void> {
        const leadUserId = lead.campaign.createdById;
        try {
            // Source 1: email already on the lead record.
            if (lead.email) {
                const rawEmail = lead.email.toLowerCase();
                const { blocked } = isBlockedByMap(rawEmail, leadUserId, suppressionMap, existingEmailByCampaign, lead.campaignId);

                if (!blocked) {
                    registerFoundEmail(rawEmail, lead.campaignId, existingEmailByCampaign);
                    await resolveAndSaveEmail({
                        leadId: lead.id,
                        email: rawEmail,
                        source: EMAIL_SOURCE.APOLLO_SEARCH,
                        campaignId: lead.campaignId,
                        qualificationScore: lead.qualificationScore,
                        recommendedAction: lead.recommendedAction,
                    });
                    return;
                }
            }

            if (lead.externalId && apolloEmailMap.has(lead.externalId)) {
                const rawEmail = apolloEmailMap.get(lead.externalId)!.toLowerCase();
                const { blocked } = isBlockedByMap(rawEmail, leadUserId, suppressionMap, existingEmailByCampaign, lead.campaignId);

                if (!blocked) {
                    registerFoundEmail(rawEmail, lead.campaignId, existingEmailByCampaign);
                    await resolveAndSaveEmail({
                        leadId: lead.id,
                        email: rawEmail,
                        source: EMAIL_SOURCE.APOLLO_REVEAL,
                        campaignId: lead.campaignId,
                        qualificationScore: lead.qualificationScore,
                        recommendedAction: lead.recommendedAction,
                    });
                    return;
                }
            }

            // Source 3: LinkedIn hydration (name recovery).
            // FIX (section 2): uses shared hydrateLeadFromLinkedIn — consistent with single-lead path.
            await hydrateLeadFromLinkedIn(lead);

            if (!lead.firstName || !lead.lastName) {
                await prisma.lead.update({
                    where: { id: lead.id },
                    data: { emailStatus: EMAIL_STATUS.NOT_FOUND, lastEnrichedAt: new Date() },
                });
                return;
            }

            const domain = extractDomain(lead.enrichmentData, lead.website);

            if (!domain) {
                await prisma.lead.update({
                    where: { id: lead.id },
                    data: { emailStatus: EMAIL_STATUS.NOT_FOUND, lastEnrichedAt: new Date() },
                });
                return;
            }

            const hunterFirstName = lead.firstName ?? "";
            const hunterLastName = lead.lastName ?? "";
            const hunterResult = await findEmailViaHunter({
                domain,
                firstName: hunterFirstName,
                lastName: hunterLastName,
            });

            if (hunterResult) {
                const normalised = hunterResult.email.toLowerCase();
                const { blocked } = isBlockedByMap(normalised, leadUserId, suppressionMap, existingEmailByCampaign, lead.campaignId);

                if (!blocked) {
                    registerFoundEmail(normalised, lead.campaignId, existingEmailByCampaign);
                    if (hunterResult.verified) {
                        await saveFoundEmail({
                            leadId: lead.id,
                            email: normalised,
                            source: EMAIL_SOURCE.HUNTER,
                            verified: true,
                            catchAll: false,
                            campaignId: lead.campaignId,
                        });
                        await cacheResolvedEmail({
                            companyId: lead.companyId,
                            firstName: lead.firstName,
                            lastName: lead.lastName,
                            domain,
                            email: normalised,
                            resolution: {
                                email: normalised,
                                source: EMAIL_SOURCE.HUNTER,
                                verified: true,
                                catchAll: false,
                            },
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
                        await cacheResolvedEmail({
                            companyId: lead.companyId,
                            firstName: lead.firstName,
                            lastName: lead.lastName,
                            domain,
                            email: normalised,
                            resolution: {
                                email: normalised,
                                source: EMAIL_SOURCE.HUNTER,
                                verified: false,
                                catchAll: false,
                            },
                        });
                    }
                    return;
                }
            }

            const cachedResolution = await maybeResolveFromEnrichmentCache({
                companyId: lead.companyId,
                firstName: lead.firstName,
                lastName: lead.lastName,
                domain,
                email: lead.email,
            });

            if (cachedResolution) {
                logger.info({ leadId: lead.id, email: cachedResolution.email }, "[email-enrichment] Batch: resolved from cache");
                await saveFoundEmail({
                    leadId: lead.id,
                    email: cachedResolution.email,
                    source: cachedResolution.source as EmailSource,
                    verified: cachedResolution.verified,
                    catchAll: cachedResolution.catchAll,
                    campaignId: lead.campaignId,
                });
                return;
            }

            const waterfallResult = await enrichPersonWaterfall({
                email: lead.email ?? undefined,
                linkedinUrl: lead.linkedinUrl ?? undefined,
                firstName: lead.firstName ?? undefined,
                lastName: lead.lastName ?? undefined,
                domain,
            });

            if (waterfallResult?.email) {
                const normalised = waterfallResult.email.toLowerCase();
                const { blocked } = isBlockedByMap(normalised, leadUserId, suppressionMap, existingEmailByCampaign, lead.campaignId);

                if (!blocked) {
                    registerFoundEmail(normalised, lead.campaignId, existingEmailByCampaign);
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

            await prisma.lead.update({
                where: { id: lead.id },
                data: { emailStatus: EMAIL_STATUS.NOT_FOUND, lastEnrichedAt: new Date() },
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
}