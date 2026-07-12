import { IntentConfig, RepliesTab, ReplyIntent } from "./replyTypes";


export const INTENT_CONFIG: Record<ReplyIntent, IntentConfig> = {
    POSITIVE: {
        label: "Positive",
        dot: "bg-emerald-400",
        badge: "bg-emerald-400/10 border border-emerald-400/20 text-emerald-400",
        text: "text-emerald-400",
    },
    MEETING_REQUEST: {
        label: "Meeting",
        dot: "bg-blue-400",
        badge: "bg-blue-400/10 border border-blue-400/20 text-blue-400",
        text: "text-blue-400",
    },
    QUESTION: {
        label: "Question",
        dot: "bg-amber-400",
        badge: "bg-amber-400/10 border border-amber-400/20 text-amber-400",
        text: "text-amber-400",
    },
    NEGATIVE: {
        label: "Negative",
        dot: "bg-red-400",
        badge: "bg-red-400/10 border border-red-400/20 text-red-400",
        text: "text-red-400",
    },
    NOT_INTERESTED: {
        label: "Not Interested",
        dot: "bg-red-600",
        badge: "bg-red-600/10 border border-red-600/20 text-red-400",
        text: "text-red-400",
    },
    OUT_OF_OFFICE: {
        label: "OOO",
        dot: "bg-slate-400",
        badge: "bg-slate-400/10 border border-slate-400/20 text-slate-400",
        text: "text-slate-400",
    },
    UNKNOWN: {
        label: "Unknown",
        dot: "bg-[var(--text-muted)]",
        badge: "bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-secondary)]",
        text: "text-[var(--text-secondary)]",
    },
};

export const INTENT_TABS: { id: RepliesTab; label: string; desc: string }[] = [
    { id: "ALL", label: "All Replies", desc: "Every inbound reply" },
    { id: "POSITIVE", label: "Positive", desc: "Warm interest signals" },
    { id: "MEETING_REQUEST", label: "Meeting Request", desc: "Explicit booking intent" },
    { id: "QUESTION", label: "Questions", desc: "Needs follow-up answer" },
    { id: "NEGATIVE", label: "Negative", desc: "Declined or pushed back" },
    { id: "NOT_INTERESTED", label: "Not Interested", desc: "Hard pass" },
    { id: "OUT_OF_OFFICE", label: "OOO", desc: "Auto-away replies" },
    { id: "NEEDS_REVIEW", label: "Needs Review", desc: "Flagged for human" },
    { id: "UNKNOWN", label: "Unknown", desc: "Unclassified intent" },
];