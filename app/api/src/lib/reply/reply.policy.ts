import { ReplyIntent, AUTO_SEND_ELIGIBLE_INTENTS, AUTO_SEND_MIN_CONFIDENCE } from "./replyTypes";
import {
    containsForceReviewSignal,
    isHostnameApproved,
    injectionSignalWeight,
} from "./reply.security";

const MAX_AUTO_SEND_BODY_LENGTH = 1_200;

export async function canAutoSend(p: {
    campaign: { autoSendRepliesEnabled: boolean };
    intent: ReplyIntent;
    confidence: number;
    draftBody: string;
    allowedLinks: string[];
}): Promise<{ ok: boolean; reason?: string }> {
    if (!p.campaign.autoSendRepliesEnabled) {
        return { ok: false, reason: "auto-send not enabled" };
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

    return { ok: true };
}