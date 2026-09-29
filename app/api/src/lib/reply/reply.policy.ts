import { ReplyIntent, AUTO_SEND_ELIGIBLE_INTENTS, AUTO_SEND_MIN_CONFIDENCE } from "./replyTypes";
import {
    containsForceReviewSignal,
    isHostnameApproved,
    injectionSignalWeight,
} from "./reply.security";
import { prisma } from "../prisma";

const MAX_AUTO_SEND_BODY_LENGTH = 1_200;
const AUTO_SEND_COOLING_OFF_MS = 4 * 60 * 60 * 1_000;
const MAX_AUTO_SEND_THREAD_DEPTH = 3;
const HARD_BLOCKED_INTENTS = new Set<ReplyIntent>(["NEGATIVE", "NOT_INTERESTED"]);

export async function canAutoSend(p: {
    leadId: string;
    campaign: { autoSendRepliesEnabled: boolean };
    intent: ReplyIntent;
    confidence: number;
    draftBody: string;
    allowedLinks: string[];
}): Promise<{ ok: boolean; reason?: string }> {
    if (!p.campaign.autoSendRepliesEnabled) {
        return { ok: false, reason: "auto-send not enabled" };
    }
    if (HARD_BLOCKED_INTENTS.has(p.intent)) {
        return { ok: false, reason: `${p.intent} is a hard-blocked intent — never auto-send` };
    }
    if (!AUTO_SEND_ELIGIBLE_INTENTS.has(p.intent)) {
        return { ok: false, reason: `${p.intent} requires review` };
    }
    if (p.confidence < AUTO_SEND_MIN_CONFIDENCE) {
        return { ok: false, reason: "confidence too low" };
    }
    if (containsForceReviewSignal(p.draftBody)) {
        return { ok: false, reason: "draft matched force-review policy pattern" };
    }
    if (p.draftBody.length > MAX_AUTO_SEND_BODY_LENGTH) {
        return { ok: false, reason: "draft unusually long" };
    }

    const injectionWeight = injectionSignalWeight(p.draftBody);
    if (injectionWeight > 0.2) {
        return { ok: false, reason: "draft contains injection-artifact language" };
    }

    const urls = p.draftBody.match(/https?:\/\/\S+/g) ?? [];
    if (urls.some((u) => !isHostnameApproved(u, p.allowedLinks))) {
        return { ok: false, reason: "draft contains an unapproved link" };
    }

    const coolingOffCutoff = new Date(Date.now() - AUTO_SEND_COOLING_OFF_MS);
    const recentAutoSend = await prisma.reply.findFirst({
        where: {
            leadId: p.leadId,
            draftSentAt: { gte: coolingOffCutoff },
        },
        select: { id: true },
    });
    if (recentAutoSend) {
        return { ok: false, reason: "cooling-off period active — last auto-send was within 4h" };
    }

    const threadDepth = await prisma.reply.count({
        where: {
            leadId: p.leadId,
            draftSentAt: { not: null },
        },
    });
    if (threadDepth >= MAX_AUTO_SEND_THREAD_DEPTH) {
        return { ok: false, reason: `max thread depth (${MAX_AUTO_SEND_THREAD_DEPTH}) reached — escalate to human` };
    }

    return { ok: true };
}