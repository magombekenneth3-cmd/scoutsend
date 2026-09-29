import { logger } from "../logger";

export type ConversationActionType =
    | "STOP_SEQUENCE"
    | "SNOOZE_UNTIL"
    | "ANSWER_AND_CONTINUE"
    | "ADVANCE_TO_STEP"
    | "BOOK_MEETING"
    | "HUMAN_REVIEW";

export type ConversationAction =
    | { type: "STOP_SEQUENCE"; reason: "NOT_INTERESTED" | "UNSUBSCRIBED" | "COMPLAINT" }
    | { type: "SNOOZE_UNTIL"; resumeAt: Date; reason: string }
    | { type: "ANSWER_AND_CONTINUE"; question: string; thenAdvanceStep: boolean }
    | { type: "ADVANCE_TO_STEP"; stepNumber: number }
    | { type: "BOOK_MEETING" }
    | { type: "HUMAN_REVIEW"; reason: string };

export interface ReplyIntent {
    type:
    | "NOT_INTERESTED"
    | "UNSUBSCRIBED"
    | "OPT_OUT"
    | "COMPLAINT"
    | "MEETING_REQUEST"
    | "QUESTION"
    | "POSITIVE"
    | "NEGATIVE"
    | "UNKNOWN";
    confidence: number;
}

export interface ReplyQuestion {
    text: string;
    confidence: number;
}

export interface TemporalConstraint {
    rawText: string;
    targetDate: Date;
}

export interface ConversationReplyAnalysis {
    intents: ReplyIntent[];
    questions: ReplyQuestion[];
    temporalConstraints: TemporalConstraint[];
    sentiment: number;
    confidence: number;
    suggestedNextStep?: number;
    requiresHumanReview: boolean;
}

export const DEFAULT_CTA_POLICY: Record<number, string> = {
    1: "End with a low-friction soft question about their current process. Do not request a call or meeting.",
    2: "Offer a specific case study, ROI asset, or relevant resource. Do not repeat Step 1's question.",
    3: "Breakup step. Warmly acknowledge you will stop reaching out unless they wish to reconnect later.",
};

const STOP_KEYWORDS = new Set([
    "unsubscribe",
    "stop emailing",
    "stop contacting",
    "remove me",
    "take me off",
    "do not contact",
    "do not email",
    "don't contact",
    "don't email",
    "opt out",
    "opt-out",
    "cease and desist",
    "stop sending",
    "no more emails",
    "leave me alone",
    "not interested",
    "please stop",
    "remove from list",
    "remove from your list",
]);

const COMPLAINT_KEYWORDS = new Set([
    "report spam",
    "reported as spam",
    "this is spam",
    "spam complaint",
    "legal action",
    "lawyer",
    "attorney",
    "gdpr violation",
    "data protection",
    "i will report",
    "cease and desist",
]);

function detectDeterministicStopSignal(replyText: string): ConversationAction | null {
    const normalized = replyText.toLowerCase().trim();

    for (const keyword of COMPLAINT_KEYWORDS) {
        if (normalized.includes(keyword)) {
            return { type: "STOP_SEQUENCE", reason: "COMPLAINT" };
        }
    }

    for (const keyword of STOP_KEYWORDS) {
        if (normalized.includes(keyword)) {
            return { type: "STOP_SEQUENCE", reason: "UNSUBSCRIBED" };
        }
    }

    return null;
}

export function evaluateConversationAction(
    analysis: ConversationReplyAnalysis,
    leadId?: string,
    rawReplyText?: string,
): ConversationAction {
    if (rawReplyText) {
        const deterministicAction = detectDeterministicStopSignal(rawReplyText);
        if (deterministicAction) {
            logger.warn(
                { leadId, action: deterministicAction },
                "[conversation-sm] Deterministic keyword match — overriding LLM classification",
            );
            return deterministicAction;
        }
    }

    const intentTypes = new Set(analysis.intents.map((i) => i.type));

    if (intentTypes.has("COMPLAINT")) {
        logger.warn({ leadId }, "[conversation-sm] Complaint detected — stopping sequence");
        return { type: "STOP_SEQUENCE", reason: "COMPLAINT" };
    }

    if (intentTypes.has("UNSUBSCRIBED") || intentTypes.has("OPT_OUT")) {
        logger.info({ leadId }, "[conversation-sm] Opt-out detected — stopping sequence");
        return { type: "STOP_SEQUENCE", reason: "UNSUBSCRIBED" };
    }

    if (intentTypes.has("NOT_INTERESTED")) {
        logger.info({ leadId }, "[conversation-sm] Not interested — stopping sequence");
        return { type: "STOP_SEQUENCE", reason: "NOT_INTERESTED" };
    }

    if (analysis.temporalConstraints.length > 0) {
        const constraint = analysis.temporalConstraints[0];
        logger.info(
            { leadId, resumeAt: constraint.targetDate },
            "[conversation-sm] Temporal constraint — snoozing",
        );
        return {
            type: "SNOOZE_UNTIL",
            resumeAt: constraint.targetDate,
            reason: constraint.rawText,
        };
    }

    if (intentTypes.has("MEETING_REQUEST")) {
        logger.info({ leadId }, "[conversation-sm] Meeting request — booking action");
        return { type: "BOOK_MEETING" };
    }

    if (analysis.questions.length > 0) {
        return {
            type: "ANSWER_AND_CONTINUE",
            question: analysis.questions[0].text,
            thenAdvanceStep: false,
        };
    }

    if (analysis.confidence < 0.5 || analysis.requiresHumanReview) {
        return {
            type: "HUMAN_REVIEW",
            reason: "Low classification confidence or compound reply flagged for review",
        };
    }

    return {
        type: "ADVANCE_TO_STEP",
        stepNumber: analysis.suggestedNextStep ?? -1,
    };
}

export function getCTAConstraintForStep(stepNumber: number): string {
    return DEFAULT_CTA_POLICY[stepNumber] ?? DEFAULT_CTA_POLICY[3];
}
