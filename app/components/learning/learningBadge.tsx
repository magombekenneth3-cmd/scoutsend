"use client";

import type { LearningEventType, LearningOutcome } from "@/app/api/learning/learningApi"

const EVENT_TYPE_CONFIG: Record<
    LearningEventType,
    { label: string; className: string }
> = {
    REVIEW_FLAGGED: {
        label: "Flagged",
        className: "bg-amber-500/15 text-amber-400 border-amber-500/25",
    },
    HUMAN_EDITED: {
        label: "Human Edited",
        className: "bg-blue-500/15 text-blue-400 border-blue-500/25",
    },
    HUMAN_APPROVED: {
        label: "Approved",
        className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
    },
    HUMAN_REJECTED: {
        label: "Rejected",
        className: "bg-red-500/15 text-red-400 border-red-500/25",
    },
    AUTO_APPROVED: {
        label: "Auto-approved",
        className: "bg-purple-500/15 text-purple-400 border-purple-500/25",
    },
};

const OUTCOME_CONFIG: Record<
    LearningOutcome,
    { label: string; className: string; dot: string }
> = {
    PENDING_REVIEW: {
        label: "Pending",
        className: "bg-amber-500/15 text-amber-400 border-amber-500/25",
        dot: "bg-amber-400",
    },
    APPROVED: {
        label: "Approved",
        className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
        dot: "bg-emerald-400",
    },
    REJECTED: {
        label: "Rejected",
        className: "bg-red-500/15 text-red-400 border-red-500/25",
        dot: "bg-red-400",
    },
    EDITED_AND_APPROVED: {
        label: "Edited & Approved",
        className: "bg-blue-500/15 text-blue-400 border-blue-500/25",
        dot: "bg-blue-400",
    },
    DISMISSED: {
        label: "Dismissed",
        className: "bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]",
        dot: "bg-[var(--text-muted)]",
    },
};

export function EventTypeBadge({ type }: { type: LearningEventType }) {
    const cfg = EVENT_TYPE_CONFIG[type] ?? {
        label: type,
        className: "bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border)]",
    };
    return (
        <span
            className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${cfg.className}`}
        >
            {cfg.label}
        </span>
    );
}

export function OutcomeBadge({ outcome }: { outcome: LearningOutcome | null }) {
    if (!outcome) return null;
    const cfg = OUTCOME_CONFIG[outcome] ?? {
        label: outcome,
        className: "bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border)]",
        dot: "bg-[var(--text-muted)]",
    };
    return (
        <span
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full border ${cfg.className}`}
        >
            <span
                className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`}
                aria-hidden="true"
            />
            {cfg.label}
        </span>
    );
}