import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";

export interface ComplianceViolation {
    code: string;
    severity: "block" | "warn";
    detail?: string | number;
}

export interface ComplianceSummary {
    checked: number;
    blocked: number;
    warned: number;
}

const PLACEHOLDER_RE =
    /\[\s*(?:first[\s_]?name|last[\s_]?name|full[\s_]?name|your\s+name|company(?:\s+name)?|website|email|title|name)\s*\]|\{\{\s*(?:first[\s_]?name|last[\s_]?name|company(?:_name)?|name|title)\s*\}\}|\{\s*(?:first[\s_]?name|last[\s_]?name|company(?:_name)?|name|title)\s*\}|\{\{[^{}]+\}\}|%[A-Z_]+%|\[\[[^\]]+\]\]/gi;

const UNSUBSCRIBE_RE = /unsubscribe|opt[\s-]?out|remove\s+(?:me|yourself)\s+from/i;

const CALENDAR_LINK_RE =
    /(?:calendly\.com|cal\.com|hubspot\.com\/meetings|meetings\.hubspot\.com|savvycal\.com|chillipiper\.com|oncehub\.com|youcanbook\.me|doodle\.com\/bp\/)[\/\w?=&%-]*/i;

const EXCESSIVE_PUNCT_RE = /[!?]{3,}/;

const ALL_CAPS_WORD_RE = /\b[A-Z]{4,}\b/g;

const KNOWN_ACRONYM_ALLOWLIST = new Set([
    "CEO", "CFO", "CTO", "COO", "CMO", "CISO", "CPO",
    "USA", "UK", "EU", "API", "SAAS", "B2B", "B2C", "CRM", "ERP",
    "ROI", "KPI", "SEO", "SEM", "FAQ", "PDF", "HTML", "URL", "HTTP", "HTTPS",
    "NASA", "IBM", "AI", "ML", "SQL", "AWS", "GCP", "SDK", "UI", "UX",
]);

interface SpamPattern {
    pattern: RegExp;
    weight: number;
}

// Minimum word count used as the denominator for spam-trigger density.
// Without this floor, a short email (e.g. 20 words) containing a single
// trigger phrase spikes to a density (1 / 20 = 5%) that sits dangerously
// close to the blocking threshold, even though the email has no other
// spam signal. Padding the denominator for short messages means density
// is only meaningful once there's enough text for it to be meaningful,
// while the absolute `totalWeight >= 4.0` check below still blocks short
// messages that are genuinely stuffed with trigger phrases.
const SPAM_DENSITY_WORD_FLOOR = 50;

const SPAM_PATTERNS: SpamPattern[] = [
    { pattern: /\bact\s+now\b/i, weight: 1.5 },
    { pattern: /\blimited[\s-]time\s+offer\b/i, weight: 1.5 },
    { pattern: /\bclick\s+here\s+immediately\b/i, weight: 2.0 },
    { pattern: /\bfree\s+gift\b/i, weight: 1.5 },
    { pattern: /\bguaranteed\s+results?\b/i, weight: 1.5 },
    { pattern: /\bno\s+risk\s+whatsoever\b/i, weight: 1.5 },
    { pattern: /\b100\s*%\s+free\b/i, weight: 1.5 },
    { pattern: /\bearn\s+extra\s+income\b/i, weight: 2.0 },
    { pattern: /\bmake\s+money\s+fast\b/i, weight: 2.0 },
    { pattern: /\brisk[\s-]free\s+offer\b/i, weight: 1.5 },
    { pattern: /\bthis\s+is\s+not\s+spam\b/i, weight: 3.0 },
    { pattern: /\bdear\s+friend\b/i, weight: 1.0 },
    { pattern: /\bcongratulations[,!]?\s+you\s+(?:have\s+)?won\b/i, weight: 3.0 },
    { pattern: /\bonce[\s-]in[\s-]a[\s-]lifetime\b/i, weight: 1.5 },
    { pattern: /\bspecial\s+promotion\b/i, weight: 1.0 },
    { pattern: /\bexclusive\s+deal\b/i, weight: 1.0 },
    { pattern: /\bdon['']t\s+miss\s+out\b/i, weight: 1.0 },
    { pattern: /\bcash\s+bonus\b/i, weight: 2.0 },
    { pattern: /\bdouble\s+your\s+(?:income|revenue|sales)\b/i, weight: 2.0 },
    { pattern: /\b(?:\$\$\$|\$\$)\b/, weight: 2.0 },
];

const EU_COUNTRY_CODES = new Set([
    "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI",
    "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT",
    "NL", "PL", "PT", "RO", "SE", "SI", "SK",
    "IS", "LI", "NO",
    "GB",
]);

const CASL_COUNTRY_CODES = new Set(["CA"]);

const COUNTRY_NAME_TO_CODE: Record<string, string> = {
    "GERMANY": "DE", "FRANCE": "FR", "SPAIN": "ES", "ITALY": "IT",
    "NETHERLANDS": "NL", "BELGIUM": "BE", "AUSTRIA": "AT", "SWEDEN": "SE",
    "DENMARK": "DK", "FINLAND": "FI", "IRELAND": "IE", "PORTUGAL": "PT",
    "POLAND": "PL", "GREECE": "GR", "CZECH REPUBLIC": "CZ", "CZECHIA": "CZ",
    "HUNGARY": "HU", "ROMANIA": "RO", "BULGARIA": "BG", "CROATIA": "HR",
    "SLOVAKIA": "SK", "SLOVENIA": "SI", "ESTONIA": "EE", "LATVIA": "LV",
    "LITHUANIA": "LT", "LUXEMBOURG": "LU", "MALTA": "MT", "CYPRUS": "CY",
    "ICELAND": "IS", "LIECHTENSTEIN": "LI", "NORWAY": "NO",
    "UNITED KINGDOM": "GB", "GREAT BRITAIN": "GB", "UK": "GB",
    "CANADA": "CA",
    "UNITED STATES": "US", "UNITED STATES OF AMERICA": "US", "USA": "US",
};

function stripHtml(text: string): string {
    return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

function stripHtmlTight(text: string): string {
    return text.replace(/<[^>]+>/g, "");
}

// Normalizes text for footer comparison by lowercasing and stripping everything
// except letters/numbers (HTML tags, punctuation, and whitespace). This lets the
// verbatim-footer check tolerate cosmetic differences an LLM rewrite commonly
// introduces — a swapped comma, different casing, a trailing period — without
// permitting substantively different text to pass.
function normalizeForFooterComparison(text: string): string {
    return stripHtmlTight(text)
        .toLowerCase()
        .normalize("NFKC")
        .replace(/[^\p{L}\p{N}]+/gu, "");
}

function wordCount(strippedText: string): number {
    const trimmed = strippedText.trim();
    return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

function checkPlaceholders(subject: string, body: string): ComplianceViolation | null {
    const combined = `${subject} ${stripHtml(body)}`;
    PLACEHOLDER_RE.lastIndex = 0;
    return PLACEHOLDER_RE.test(combined)
        ? { code: "unfilled_placeholder", severity: "block" }
        : null;
}

function checkSubjectLength(subject: string): ComplianceViolation | null {
    return subject.length > 100
        ? { code: "subject_too_long", severity: "warn", detail: subject.length }
        : null;
}

function checkBodyLength(strippedBody: string): ComplianceViolation | null {
    const words = wordCount(strippedBody);
    if (words < 20) return { code: "body_too_short", severity: "block", detail: words };
    if (words > 800) return { code: "body_too_long", severity: "warn", detail: words };
    return null;
}

export function checkUnsubscribeFooterPresent(
    body: string,
    footer?: string | null,
): ComplianceViolation | null {
    if (!UNSUBSCRIBE_RE.test(body)) {
        return { code: "missing_unsubscribe", severity: "block" };
    }
    const trimmedFooter = footer?.trim();
    if (trimmedFooter && trimmedFooter.length > 0) {
        const normalizedFooter = normalizeForFooterComparison(trimmedFooter);
        const normalizedBody = normalizeForFooterComparison(body);
        if (normalizedFooter.length > 0 && !normalizedBody.includes(normalizedFooter)) {
            return { code: "unsubscribe_footer_not_verbatim", severity: "block" };
        }
    }
    return null;
}

function checkExcessivePunctuation(strippedText: string): ComplianceViolation | null {
    return EXCESSIVE_PUNCT_RE.test(strippedText)
        ? { code: "excessive_punctuation", severity: "warn" }
        : null;
}

function checkAllCaps(strippedText: string): ComplianceViolation | null {
    const matches = (strippedText.match(ALL_CAPS_WORD_RE) ?? []).filter(
        (word) => !KNOWN_ACRONYM_ALLOWLIST.has(word),
    );
    return matches.length >= 2
        ? { code: "excessive_all_caps", severity: "warn", detail: matches.length }
        : null;
}

function checkSpamTriggers(subject: string, body: string): ComplianceViolation | null {
    const tight = `${subject} ${stripHtmlTight(body)}`;
    const totalWords = wordCount(stripHtml(`${subject} ${body}`)) || 1;
    const densityBaseline = Math.max(totalWords, SPAM_DENSITY_WORD_FLOOR);

    let totalWeight = 0;
    for (const { pattern, weight } of SPAM_PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(tight)) totalWeight += weight;
    }

    if (totalWeight === 0) return null;

    const density = totalWeight / densityBaseline;
    const densityStr = density.toFixed(3);

    return density > 0.08 || totalWeight >= 4.0
        ? { code: "high_spam_trigger_density", severity: "block", detail: densityStr }
        : { code: "spam_triggers_detected", severity: "warn", detail: densityStr };
}

function checkCalendarLink(subject: string, body: string): ComplianceViolation | null {
    const combined = `${subject} ${stripHtml(body)}`;
    CALENDAR_LINK_RE.lastIndex = 0;
    return CALENDAR_LINK_RE.test(combined)
        ? { code: "calendar_link_in_cold_outbound", severity: "warn" }
        : null;
}

function normalizeCountryCode(raw: string): string | null {
    const upper = raw.trim().toUpperCase();
    if (upper.length === 2) return upper;
    if (COUNTRY_NAME_TO_CODE[upper]) return COUNTRY_NAME_TO_CODE[upper];
    return null;
}

const VALID_CASL_BASES = new Set(["EXPLICIT_CONSENT", "EXISTING_BUSINESS_RELATIONSHIP"]);
const VALID_GDPR_BASES = new Set(["EXPLICIT_CONSENT", "EXISTING_BUSINESS_RELATIONSHIP"]);

function checkGdprCompliance(leadCountry: string | null, consentBasis?: string | null): ComplianceViolation | null {
    if (!leadCountry) return null;
    const code = normalizeCountryCode(leadCountry);
    if (code && EU_COUNTRY_CODES.has(code)) {
        if (!consentBasis || !VALID_GDPR_BASES.has(consentBasis)) {
            return { code: "gdpr_region_warning", severity: "block", detail: code };
        }
    }
    return null;
}

function checkCaslCompliance(leadCountry: string | null, consentBasis?: string | null): ComplianceViolation | null {
    if (!leadCountry) return null;
    const code = normalizeCountryCode(leadCountry);
    if (code && CASL_COUNTRY_CODES.has(code)) {
        if (!consentBasis || !VALID_CASL_BASES.has(consentBasis)) {
            return { code: "casl_region_warning", severity: "block", detail: code };
        }
    }
    return null;
}

export function auditMessage(
    subject: string,
    body: string,
    leadCountry?: string | null,
    consentBasis?: string | null,
    unsubscribeFooter?: string | null,
): ComplianceViolation[] {
    const strippedBody = stripHtml(body);
    const strippedCombined = `${subject} ${strippedBody}`;

    return [
        checkPlaceholders(subject, body),
        checkSubjectLength(subject),
        checkBodyLength(strippedBody),
        checkUnsubscribeFooterPresent(body, unsubscribeFooter),
        checkExcessivePunctuation(strippedCombined),
        checkAllCaps(strippedCombined),
        checkSpamTriggers(subject, body),
        checkCalendarLink(subject, body),
        checkGdprCompliance(leadCountry ?? null, consentBasis),
        checkCaslCompliance(leadCountry ?? null, consentBasis),
    ].filter((v): v is ComplianceViolation => v !== null);
}

function violationCodes(violations: ComplianceViolation[]): string[] {
    return violations.map((v) => (v.detail !== undefined ? `${v.code}:${v.detail}` : v.code));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeEnrichmentData(value: unknown): Record<string, unknown> {
    return isPlainObject(value) ? value : {};
}

function extractLeadCountry(leadEd: Record<string, unknown>): string | null {
    const country = leadEd.country;
    if (typeof country === "string" && country.trim().length > 0) return country;
    const countryCode = leadEd.countryCode;
    if (typeof countryCode === "string" && countryCode.trim().length > 0) return countryCode;
    return null;
}

export async function runComplianceAgent(campaignId: string): Promise<ComplianceSummary> {
    const approved = await prisma.outreachMessage.findMany({
        where: {
            lead: { campaignId },
            approvalStatus: "APPROVED",
            deliveryState: "QUEUED",
        },
        select: {
            id: true,
            subject: true,
            body: true,
            enrichmentData: true,
            lead: {
                select: {
                    enrichmentData: true,
                },
            },
        },
    });

    if (approved.length === 0) {
        return { checked: 0, blocked: 0, warned: 0 };
    }

    const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { createdById: true },
    });
    if (!campaign) {
        return { checked: 0, blocked: 0, warned: 0 };
    }

    const brandSettings = await prisma.brandSettings.findUnique({
        where: { userId: campaign.createdById },
        select: { unsubscribeText: true },
    });

    const unsubscribeFooter =
        brandSettings?.unsubscribeText ??
        "You received this email because you match our ideal customer profile. To unsubscribe, reply with 'unsubscribe'.";

    type AuditRecord = {
        id: string;
        violations: ComplianceViolation[];
        existingEd: Record<string, unknown>;
        blocked: boolean;
    };

    const audits: AuditRecord[] = approved.map((msg) => {
        const leadEd = safeEnrichmentData(msg.lead?.enrichmentData);
        const leadCountry = extractLeadCountry(leadEd);
        const consentBasis = typeof leadEd.consentBasis === "string" ? leadEd.consentBasis : null;

        const violations = auditMessage(msg.subject, msg.body, leadCountry, consentBasis, unsubscribeFooter);
        return {
            id: msg.id,
            violations,
            existingEd: safeEnrichmentData(msg.enrichmentData),
            blocked: violations.some((v) => v.severity === "block"),
        };
    });

    const blockedAudits = audits.filter((a) => a.blocked);
    const warnedAudits = audits.filter((a) => !a.blocked && a.violations.length > 0);

    const updates = [
        ...blockedAudits.map((a) =>
            prisma.outreachMessage.update({
                where: { id: a.id, deliveryState: "QUEUED" },
                data: {
                    approvalStatus: "PENDING",
                    deliveryState: "DRAFT",
                    enrichmentData: {
                        ...a.existingEd,
                        complianceViolations: violationCodes(a.violations),
                        complianceBlockedAt: new Date().toISOString(),
                        complianceBlockHistory: [
                            ...(Array.isArray(a.existingEd.complianceBlockHistory)
                                ? (a.existingEd.complianceBlockHistory as unknown[])
                                : []),
                            {
                                at: new Date().toISOString(),
                                codes: violationCodes(a.violations),
                            },
                        ],
                    } as Prisma.InputJsonValue,
                },
            }),
        ),
        ...warnedAudits.map((a) =>
            prisma.outreachMessage.update({
                where: { id: a.id },
                data: {
                    enrichmentData: {
                        ...a.existingEd,
                        complianceWarnings: violationCodes(a.violations),
                    } as Prisma.InputJsonValue,
                },
            }),
        ),
    ];

    if (updates.length > 0) {
        try {
            await prisma.$transaction(updates);
        } catch (err) {
            logger.error(
                { campaignId, err },
                "[compliance.agent] Failed to persist audit results, some messages may have changed state concurrently",
            );
            throw err;
        }
    }

    if (blockedAudits.length > 0) {
        logger.warn(
            {
                campaignId,
                count: blockedAudits.length,
                violations: blockedAudits.map((a) => ({ id: a.id, codes: violationCodes(a.violations) })),
            },
            "[compliance.agent] Messages blocked",
        );
    }

    logger.info(
        { campaignId, checked: approved.length, blocked: blockedAudits.length, warned: warnedAudits.length },
        "[compliance.agent] Complete",
    );

    return { checked: approved.length, blocked: blockedAudits.length, warned: warnedAudits.length };
}

export function checkTextSpam(text: string): { matchesCount: number } {
    const tight = stripHtmlTight(text);
    let matchesCount = 0;
    for (const { pattern } of SPAM_PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(tight)) {
            matchesCount++;
        }
    }
    return { matchesCount };
}