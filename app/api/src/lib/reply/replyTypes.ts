export type ReplyIntent =
    | "POSITIVE"
    | "NEGATIVE"
    | "NOT_INTERESTED"
    | "OUT_OF_OFFICE"
    | "MEETING_REQUEST"
    | "QUESTION"
    | "UNKNOWN";

export interface ReplyClassification {
    intent: ReplyIntent;
    sentimentScore: number;
    confidence: number;
    requiresHumanReview: boolean;
    summary: string;
    buyingStage: string | null;
    painPoints: string[];
    competitorsMentioned: string[];
    budgetSignal: string | null;
    timelineSignal: string | null;
}

export interface DraftReply {
    subject: string;
    body: string;
}

export interface MeetingDraftResult extends DraftReply {
    meetingLinkInjected: boolean;
    bookingLink: string | null;
}

export const AUTO_SEND_ELIGIBLE_INTENTS = new Set<ReplyIntent>(["MEETING_REQUEST"]);
export const AUTO_SEND_MIN_CONFIDENCE = 0.93;

export const PROMPT_VERSIONS = {
    CLASSIFIER: "classify.v1",
    DRAFTER: "draft.v1",
    MEETING_DRAFTER: "meeting.v1",
    OOO_EXTRACTOR: "ooo.v1",
} as const;

export const CLASSIFIER_TIMEOUT_MS = 10_000;
export const DRAFTER_TIMEOUT_MS = 20_000;
export const MAX_RETRY_ATTEMPTS = 3;
export const RETRY_BASE_MS = 500;
export const SEM_LIMIT = 10;
export const SEM_ACQUIRE_TIMEOUT_MS = 15_000;
export const CB_THRESHOLD = 5;
export const CB_COOLDOWN_MS = 60_000;
export const IDEMPOTENCY_TTL_MS = 3_600_000;

/* ─── Frontend-facing types ────────────────────────────────────────────────── */

/** Union of all filterable tab keys in the Replies inbox. */
export type RepliesTab =
    | "ALL"
    | "NEEDS_REVIEW"
    | ReplyIntent;

/** Pagination metadata returned by the replies list endpoint. */
export interface RepliesMeta {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

/** Per-tab unread / total counts shown on the tab bar. */
export type TabCounts = Partial<Record<RepliesTab, number>>;

/** Minimal lead shape returned nested inside a Reply from the API. */
export interface ReplyLead {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    companyName: string;
}

/** Minimal outreach message shape nested inside a Reply from the API. */
export interface ReplyOutreachMessage {
    id: string;
    subject: string;
    body: string;
    sentAt?: string | null;
    isFollowUp?: boolean;
    followUpStep?: number | null;
}

/** A single reply as returned from the API (shaped by the Prisma select). */
export interface Reply {
    id: string;
    body: string;
    intent: ReplyIntent;
    sentimentScore?: number | null;
    confidence?: number | null;
    requiresHumanReview: boolean;
    draftSubject?: string | null;
    draftBody?: string | null;
    draftSentAt?: string | null;
    objectionCategory?: string | null;
    buyingStage?: string | null;
    painPoints?: string[] | null;
    competitorsMentioned?: string[] | null;
    budgetSignal?: string | null;
    timelineSignal?: string | null;
    createdAt: string;
    lead: ReplyLead;
    outreachMessage: ReplyOutreachMessage;
}

/** Paginated API response shape for the replies list endpoint. */
export interface RepliesResponse {
    data: Reply[];
    meta: RepliesMeta;
}

/** Visual config shape for a single intent type. */
export interface IntentConfig {
    label: string;
    dot: string;
    badge: string;
    text: string;
}