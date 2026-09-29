import { callGemini, MODELS } from "../../modules/gemini/gemini.client";
import { logger } from "../../lib/logger";
import { sanitizeBody } from "./reply.security";
import {
    guardedCall,
    withRetry,
    withTimeout,
    repairAndParseJSON,
    recordMetric,
} from "./reply.infrastructure";
import { OOODateSchema } from "./reply.schema";
import { PROMPT_VERSIONS, CLASSIFIER_TIMEOUT_MS } from "./replyTypes";

const OOO_RETURN_PATTERNS: RegExp[] = [
    /(?:back|returning|available)\s+(?:on\s+)?([A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?)/i,
    /until\s+([A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?)/i,
    /returns?\s+(?:on\s+)?([A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?)/i,
    /(?:back|returning)\s+(?:on\s+)?(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)/i,
    /until\s+(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)/i,
    /(?:office|desk)\s+(?:from|on)\s+([A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?)/i,
    /(?:back|returning|available)\s+(?:on\s+)?(?:next\s+)?(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?:\s+after\s+(?:the\s+)?[a-z\s]+)?/i,
    /(?:back|returning|available)\s+in\s+(\d+)\s+(days?|weeks?)/i,
    /back\s+tomorrow/i,
    /available\s+tomorrow/i,
    /back\s+(?:next\s+week|early\s+next\s+week|late\s+next\s+week)/i,
    /back\s+(?:after|following)\s+(?:the\s+)?(?:holiday|vacation|weekend|break|thanksgiving|christmas|new\s+year|labor\s+day|memorial\s+day)/i,
    /out\s+until\s+further\s+notice/i,
];

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function resolveRelativeDate(match: RegExpMatchArray): Date | null {
    const full = match[0].toLowerCase();
    const now = new Date();

    if (/back\s+tomorrow|available\s+tomorrow/.test(full)) {
        const d = new Date(now);
        d.setDate(d.getDate() + 1);
        return d;
    }

    if (/back\s+(?:next\s+week|early\s+next\s+week)/.test(full)) {
        const d = new Date(now);
        const daysUntilMonday = (1 + 7 - now.getDay()) % 7 || 7;
        d.setDate(d.getDate() + daysUntilMonday);
        return d;
    }

    if (/back\s+(?:after|following)\s+(?:the\s+)?(?:holiday|vacation|weekend|break|thanksgiving|christmas|new\s+year|labor\s+day|memorial\s+day)/.test(full)) {
        const d = new Date(now);
        d.setDate(d.getDate() + 7);
        return d;
    }

    if (/out\s+until\s+further\s+notice/.test(full)) {
        const d = new Date(now);
        d.setDate(d.getDate() + 14);
        return d;
    }

    const dayMatch = full.match(/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
    if (dayMatch) {
        const targetDay = DAY_NAMES.indexOf(dayMatch[1]);
        const currentDay = now.getDay();
        let daysUntil = targetDay - currentDay;
        if (daysUntil <= 0) daysUntil += 7;
        if (/next/.test(full) && daysUntil < 7) daysUntil += 7;
        const d = new Date(now);
        d.setDate(d.getDate() + daysUntil);
        return d;
    }

    const relMatch = full.match(/in\s+(\d+)\s+(days?|weeks?)/);
    if (relMatch) {
        const n = parseInt(relMatch[1], 10);
        const isWeeks = relMatch[2].startsWith("week");
        const d = new Date(now);
        d.setDate(d.getDate() + (isWeeks ? n * 7 : n));
        return d;
    }

    return null;
}

function parseReturnDateFromText(body: string): Date | null {
    const now = new Date();
    for (const pattern of OOO_RETURN_PATTERNS) {
        const match = body.match(pattern);
        if (!match) continue;
        const relative = resolveRelativeDate(match);
        if (relative && relative > now) return relative;
        if (match[1]) {
            const parsed = new Date(match[1]);
            if (!isNaN(parsed.getTime()) && parsed > now) return parsed;
        }
    }
    return null;
}

export async function resolveOOOReturnDate(params: {
    body: string;
    messageId: string;
}): Promise<Date | null> {
    const { body, messageId } = params;
    const sanitized = sanitizeBody(body);

    const regexResult = parseReturnDateFromText(sanitized);
    if (regexResult) return regexResult;

    try {
        const start = Date.now();
        const nowIso = new Date().toISOString().split("T")[0];
        const dayName = DAY_NAMES[new Date().getDay()];
        const { text } = await withTimeout(
            () =>
                withRetry(() =>
                    guardedCall(() =>
                        callGemini({
                            agentName: PROMPT_VERSIONS.OOO_EXTRACTOR,
                            model: MODELS.REVIEW,
                            systemPrompt: `Extract a return date from an out-of-office email. Today is ${nowIso} (${dayName}).

Return ONLY a JSON object: { "returnDate": string | null }
- returnDate: ISO date string YYYY-MM-DD, or null if unresolvable.
- Handle complex phrases: "back next Tuesday after the holiday" -> calculate the exact date for next Tuesday, "back after the break" -> today +7 days, "out through next week" -> date of next Monday, "back in 2 weeks" -> today +14 days.
- If the phrase is vague ("a few days"), resolve to today +4 days.
- Never return a date in the past. If the resolved date is in the past, return null.`,
                            userPrompt: sanitized,
                            metadata: { messageId },
                            temperature: 0,
                        }),
                    ),
                ),
            CLASSIFIER_TIMEOUT_MS,
        );

        recordMetric("reply.ooo_extractor.latency_ms", Date.now() - start, { messageId });

        const raw = repairAndParseJSON<unknown>(text);
        const parsed = OOODateSchema.safeParse(raw);
        if (parsed.success && parsed.data.returnDate) {
            const date = new Date(parsed.data.returnDate);
            if (!isNaN(date.getTime()) && date > new Date()) return date;
        }
        const fallback = new Date();
        fallback.setDate(fallback.getDate() + 7);
        return fallback;
    } catch (err) {
        recordMetric("reply.ooo_extractor.error", 0, { messageId });
        logger.warn({ err, messageId }, "[reply.ooo] OOO date extraction via Gemini failed — using 7-day fallback");
        const fallback = new Date();
        fallback.setDate(fallback.getDate() + 7);
        return fallback;
    }
}