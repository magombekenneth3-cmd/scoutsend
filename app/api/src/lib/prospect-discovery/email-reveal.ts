import { serperSearchFull } from "../serper";
import { callGemini, MODELS, parseSafeJson } from "../../modules/gemini/gemini.client";
import { cacheGetNullable, cacheSetNullable } from "../../modules/gemini/discoveryLib/cache";
import { logger } from "../logger";
import { prisma } from "../prisma";
import {
    EMAIL_PATTERN,
    ROLE_ACCOUNT_PREFIXES,
    PLACEHOLDER_DOMAINS,
    isValidEmailCandidate,
    scoreEmail,
    buildSerpQueries,
    extractLinkedInSlug,
    generatePatternCandidates,
    verifyMxRecord,
    resolveDomain,
    resolveApolloApiKey,
    inferAndApplyPatternFromSibling,
} from "./shared";

const REVEAL_CACHE_TTL_S = 60 * 60 * 24 * 14;

export async function searchSerpEmail(
    domain: string,
    firstName: string,
    lastName: string,
    companyName: string,
): Promise<string | null> {
    const queries = buildSerpQueries(firstName, lastName, companyName, domain);
    if (queries.length === 0) return null;

    const allCandidates: Array<{ email: string; score: number }> = [];

    await Promise.allSettled(
        queries.map(async (query) => {
            try {
                const data = await serperSearchFull(query, 5);
                const textBlob = [
                    data.answerBox?.snippet || "",
                    data.knowledgeGraph?.description || "",
                    ...(data.organic || []).map((o) => `${o.title || ""} ${o.snippet || ""} ${o.link || ""}`),
                ].join(" ");

                const raw = textBlob.match(EMAIL_PATTERN) || [];
                for (const rawEmail of raw) {
                    const email = rawEmail.toLowerCase().replace(/\.$/, "");
                    if (!isValidEmailCandidate(email)) continue;
                    const score = scoreEmail(email, firstName, lastName, domain);
                    if (score > 0) allCandidates.push({ email, score });
                }
            } catch (err) {
                logger.warn({ err, query }, "[prospecting] SERP email query failed");
            }
        }),
    );

    if (allCandidates.length === 0) return null;

    const seen = new Map<string, number>();
    for (const c of allCandidates) {
        seen.set(c.email, (seen.get(c.email) || 0) + c.score);
    }
    const deduped = Array.from(seen.entries())
        .map(([email, score]) => ({ email, score }))
        .sort((a, b) => b.score - a.score);

    const companyDomainMatch = deduped.find((c) => domain && c.email.endsWith(`@${domain}`));
    if (companyDomainMatch) return companyDomainMatch.email;

    const bestMatch = deduped[0];
    if (bestMatch && bestMatch.score >= 20) return bestMatch.email;

    return null;
}

export async function predictEmailWithGemini(
    firstName: string,
    lastName: string,
    companyName: string,
    domain: string,
): Promise<string | null> {
    if (!firstName || !domain || PLACEHOLDER_DOMAINS.has(domain)) return null;

    const patterns = generatePatternCandidates(firstName, lastName, domain);
    const patternList = patterns.slice(0, 4).join(", ");

    try {
        const { text } = await callGemini({
            agentName: "prospecting.email-prediction",
            model: MODELS.RESEARCH,
            systemPrompt: [
                "You are an expert at predicting professional business email addresses.",
                "Given a person's name, company, and domain, predict the most likely email address format.",
                "Common B2B patterns in order of frequency: first.last@domain (40%), flast@domain (25%), first@domain (15%), firstlast@domain (12%), f.last@domain (8%).",
                "Return ONLY valid JSON: { \"email\": \"predicted@domain.com\", \"confidence\": 0.85, \"pattern\": \"first.last\" }",
                "Never return role accounts (info@, contact@, sales@). Never return generic addresses.",
            ].join(" "),
            userPrompt: [
                `First Name: ${firstName}`,
                `Last Name: ${lastName}`,
                `Company: ${companyName}`,
                `Domain: ${domain}`,
                `Common pattern candidates: ${patternList}`,
            ].join("\n"),
            metadata: { source: "gemini-email-predict" },
            temperature: 0.05,
            responseMimeType: "application/json",
        });

        const parsed = parseSafeJson<{ email?: string; confidence?: number }>(text);
        if (parsed?.email && typeof parsed.email === "string" && parsed.email.includes("@")) {
            const candidate = parsed.email.toLowerCase().trim();
            if (isValidEmailCandidate(candidate) && (!domain || candidate.endsWith(`@${domain}`))) {
                const conf = typeof parsed.confidence === "number" ? parsed.confidence : 0.7;
                if (conf >= 0.5) return candidate;
            }
        }
    } catch (err) {
        logger.debug({ err }, "[prospecting] Gemini email prediction failed — falling back to default pattern");
    }

    return patterns[0] ?? null;
}

export async function revealApolloEmail(apolloId: string): Promise<string | null> {
    const apiKey = resolveApolloApiKey();
    if (!apiKey || !apolloId) return null;

    try {
        const res = await fetch("https://api.apollo.io/api/v1/people/bulk_match", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
            body: JSON.stringify({
                details: [{ id: apolloId }],
                reveal_personal_emails: false,
                reveal_phone_number: false,
            }),
            signal: AbortSignal.timeout(10000),
        });

        if (!res.ok) return null;
        const data = (await res.json()) as { matches?: Array<{ email?: string }> };
        const email = data.matches?.[0]?.email;
        if (email && isValidEmailCandidate(email.toLowerCase())) {
            return email.toLowerCase();
        }
        return null;
    } catch {
        return null;
    }
}

export interface EmailRevealResult {
    email: string | null;
    emailStatus: "VERIFIED" | "UNVERIFIED" | "NOT_FOUND";
    source: string;
    mxValid: boolean;
    isRoleAccount: boolean;
}

export async function resolveEmailForProspect(params: {
    externalId?: string | null;
    firstName?: string;
    lastName?: string;
    companyName?: string;
    website?: string;
    currentEmail?: string | null;
    linkedinUrl?: string | null;
}): Promise<EmailRevealResult> {
    const {
        externalId,
        firstName = "",
        lastName = "",
        companyName = "",
        website = "",
        currentEmail = null,
        linkedinUrl = null,
    } = params;

    const domain = resolveDomain(website, currentEmail, companyName);

    let resolvedEmail: string | null = null;
    let source = "UNVERIFIED_PATTERN";

    // 1. Existing local/company evidence: Infer pattern from company sibling
    if (domain && firstName) {
        const localSibling = await prisma.lead.findFirst({
            where: {
                domain,
                email: { not: null },
                deletedAt: null,
            },
            select: { email: true, firstName: true, lastName: true },
        });

        if (localSibling?.email) {
            const candidate = inferAndApplyPatternFromSibling(
                localSibling.email,
                localSibling.firstName,
                localSibling.lastName,
                firstName,
                lastName,
                domain
            );
            if (candidate) {
                resolvedEmail = candidate;
                source = "LOCAL_CACHE_PATTERN";
            }
        }
    }

    const cacheKey = domain && (firstName || lastName)
        ? `serp-email:${firstName}:${lastName}:${domain}`.toLowerCase()
        : null;

    if (cacheKey && !resolvedEmail) {
        const cached = await cacheGetNullable(cacheKey);
        if (cached !== undefined) {
            if (cached === null) {
                return { email: null, emailStatus: "NOT_FOUND", source: "EXHAUSTED_CACHED", mxValid: false, isRoleAccount: false };
            }
            const emailPrefix = cached.split("@")[0]?.toLowerCase() || "";
            const isRoleAccount = ROLE_ACCOUNT_PREFIXES.has(emailPrefix);
            const hasMx = await verifyMxRecord(cached.split("@")[1] || domain);
            return {
                email: cached,
                emailStatus: isRoleAccount || !hasMx ? "UNVERIFIED" : "VERIFIED",
                source: "CACHED",
                mxValid: hasMx,
                isRoleAccount,
            };
        }
    }

    // 2. Public web explicit evidence (SERP Search)
    if (!resolvedEmail && (firstName || companyName)) {
        resolvedEmail = await searchSerpEmail(domain, firstName, lastName, companyName);
        if (resolvedEmail) source = "SERP_SEARCH_VERIFIED";
    }

    // 3. Paid provider reveal (Apollo) — Re-ordered before Gemini prediction
    if (
        !resolvedEmail &&
        externalId &&
        typeof externalId === "string" &&
        !externalId.startsWith("lead-") &&
        !externalId.startsWith("serp-")
    ) {
        resolvedEmail = await revealApolloEmail(externalId);
        if (resolvedEmail) source = "APOLLO_PAID_REVEAL";
    }

    // 4. LLM pattern prediction (Gemini)
    if (!resolvedEmail && firstName && domain) {
        resolvedEmail = await predictEmailWithGemini(firstName, lastName, companyName, domain);
        if (resolvedEmail) source = "GEMINI_PATTERN_PREDICTION";
    }

    // 5. LinkedIn profile derived candidate
    if (!resolvedEmail && linkedinUrl && typeof linkedinUrl === "string" && domain) {
        const slug = extractLinkedInSlug(linkedinUrl);
        if (slug) {
            const cleanFirst = firstName.toLowerCase().replace(/[^a-z]/g, "");
            const cleanLast = lastName.toLowerCase().replace(/[^a-z]/g, "");
            const candidate = cleanLast ? `${cleanFirst}.${cleanLast}@${domain}` : `${cleanFirst}@${domain}`;
            if (isValidEmailCandidate(candidate)) {
                resolvedEmail = candidate;
                source = "LINKEDIN_PROFILE_DERIVED";
            }
        }
    }

    // 6. Deterministic pattern fallback
    if (!resolvedEmail && firstName && domain) {
        const patterns = generatePatternCandidates(firstName, lastName, domain);
        if (patterns[0]) {
            resolvedEmail = patterns[0];
            source = "PATTERN_GENERATED";
        }
    }

    if (cacheKey) {
        await cacheSetNullable(cacheKey, resolvedEmail, REVEAL_CACHE_TTL_S);
    }

    if (!resolvedEmail) {
        return { email: null, emailStatus: "NOT_FOUND", source: "EXHAUSTED", mxValid: false, isRoleAccount: false };
    }

    const emailPrefix = resolvedEmail.split("@")[0]?.toLowerCase() || "";
    const emailDomain = resolvedEmail.split("@")[1]?.toLowerCase() || domain;
    const isRoleAccount = ROLE_ACCOUNT_PREFIXES.has(emailPrefix);
    const hasMx = await verifyMxRecord(emailDomain);

    // MX records only prove domain infrastructure, NOT specific mailbox existence.
    // Only verified provider lookups with explicit mailbox evidence yield VERIFIED.
    const providerVerifiedSources = new Set([
        "APOLLO_PAID_REVEAL",
        "SERP_SEARCH_VERIFIED",
    ]);

    const isVerified =
        !isRoleAccount &&
        hasMx &&
        providerVerifiedSources.has(source);

    return {
        email: resolvedEmail,
        emailStatus: isVerified ? "VERIFIED" : "UNVERIFIED",
        source: isRoleAccount ? "ROLE_ACCOUNT_UNVERIFIED" : source,
        mxValid: hasMx,
        isRoleAccount,
    };
}