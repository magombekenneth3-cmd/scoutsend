const INJECTION_PATTERNS: RegExp[] = [
    /\b(ignore\s+(all|previous)\s+instructions?)\b/i,
    /\b(system\s+prompt)\b/i,
    /\b(you\s+are\s+now)\b/i,
    /\b(disregard\s+(all|previous|your))\b/i,
    /\b(forget\s+(all|previous|your)\s+instructions?)\b/i,
    /\b(new\s+instructions?\s+follow)\b/i,
    /\bDAN\s+mode\b/i,
    /\bjailbreak\b/i,
    /\bpretend\s+(to\s+be|you\s+are)\b/i,
    /\bact\s+as\s+(?:an?\s+)?(?:unrestricted|unfiltered|jailbroken)\b/i,
];

const IMPERATIVE_DIRECTIVE_PATTERN =
    /\b(ignore|disregard|forget|override|bypass|reset|pretend|act\s+as|you\s+are\s+now|new\s+instruction)\b/i;

const TAG_DELIMITER_PATTERN = /<\/?[a-z_]{2,}>/i;

export const FORCE_REVIEW_PATTERNS: RegExp[] = [
    /\b(unsubscribe|remove\s+me|opt[-\s]out|stop\s+emailing|stop\s+contacting|cease\s+and\s+desist)\b/i,
    /\b(lawsuit|legal\s+action|attorney|lawyer|counsel|litigat)\b/i,
    /\b(spam|junk\s+mail|report\s+you|mark\s+as\s+spam)\b/i,
    /\b(invoice|payment\s+due|billing\s+department|purchase\s+order|PO\s+number|procurement)\b/i,
    /\b(security\s+(questionnaire|assessment|review)|compliance\s+(review|audit))\b/i,
    /\b(threat|threaten|hostile)\b/i,
];

const SAFE_URL_PROTOCOLS = new Set(["https:", "http:"]);

export function sanitizeBody(body: string): string {
    return body
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/\s{2,}/g, " ")
        .trim();
}

export function generateNonce(): string {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

export function injectionSignalWeight(text: string): number {
    let weight = 0;
    for (const pattern of INJECTION_PATTERNS) {
        if (pattern.test(text)) weight += 0.3;
    }
    const sentences = text.split(/[.!?]+\s+/);
    for (const sentence of sentences) {
        if (IMPERATIVE_DIRECTIVE_PATTERN.test(sentence)) weight += 0.15;
    }
    if (TAG_DELIMITER_PATTERN.test(text)) weight += 0.1;
    return Math.min(weight, 1);
}

export function containsForceReviewSignal(text: string): boolean {
    return FORCE_REVIEW_PATTERNS.some((p) => p.test(text));
}

export function isUrlSafe(rawUrl: string): boolean {
    try {
        const url = new URL(rawUrl);
        return SAFE_URL_PROTOCOLS.has(url.protocol);
    } catch {
        return false;
    }
}

export function isHostnameApproved(rawUrl: string, allowedLinks: string[]): boolean {
    try {
        const { hostname, protocol } = new URL(rawUrl);
        if (!SAFE_URL_PROTOCOLS.has(protocol)) return false;
        return allowedLinks.some((a) => {
            try {
                const ah = new URL(a).hostname;
                return hostname === ah || hostname.endsWith(`.${ah}`);
            } catch {
                return false;
            }
        });
    } catch {
        return false;
    }
}

export function validateBookingLink(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!isUrlSafe(trimmed)) return null;
    return trimmed;
}