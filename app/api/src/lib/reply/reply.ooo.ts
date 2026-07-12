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
    /back\s+(?:next\s+)?(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i,
    /returning\s+(?:next\s+)?(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i,
    /(?:back|available|returning)\s+in\s+(\d+)\s+(days?|weeks?)/i,
    /back\s+tomorrow/i,
    /available\s+tomorrow/i,
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
        const { text } = await withTimeout(
            () =>
                withRetry(() =>
                    guardedCall(() =>
                        callGemini({
                            agentName: PROMPT_VERSIONS.OOO_EXTRACTOR,
                            model: MODELS.REVIEW,
                            systemPrompt: `Extract a return date from an out-of-office email. Today is ${new Date().toISOString().split("T")[0]}.

Return ONLY a JSON object: { "returnDate": string | null }
- returnDate: ISO date string YYYY-MM-DD, or null if unresolvable.
- Resolve relative phrases: "next Monday" → the actual Monday date, "back in a week" → today +7 days, "back tomorrow" → tomorrow's date, "back in 2 weeks" → today +14 days.
- If the person says "a few days" or is too vague to resolve to a specific date, return null.
- Never return a date that has already passed. If the resolved date is in the past, return null.`,
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
        if (!parsed.success || !parsed.data.returnDate) return null;

        const date = new Date(parsed.data.returnDate);
        return !isNaN(date.getTime()) && date > new Date() ? date : null;
    } catch (err) {
        recordMetric("reply.ooo_extractor.error", 0, { messageId });
        logger.warn({ err, messageId }, "[reply.ooo] OOO date extraction via Gemini failed");
        return null;
    }
}