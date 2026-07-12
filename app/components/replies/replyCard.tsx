"use client";

import { INTENT_CONFIG } from "@/app/api/src/lib/reply/replyConfig";
import { SentimentBar } from "./SentimentBar";

import type { Reply } from "@/app/api/src/lib/reply/replyTypes";
import { formatTimeAgo, getAvatarGradient, getInitials } from "@/app/api/src/lib/reply/reply.utils";

interface ReplyCardProps {
    reply: Reply;
    selected: boolean;
    onClick: () => void;
}

export function ReplyCard({ reply, selected, onClick }: ReplyCardProps) {
    const cfg = INTENT_CONFIG[reply.intent];

    return (
        <button
            onClick={onClick}
            aria-pressed={selected}
            className={[
                "w-full text-left px-4 py-3.5 border-b border-[var(--border)] transition-all duration-150",
                "hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--red)]",
                selected
                    ? "bg-[var(--surface-2)] border-l-2 border-l-[var(--red)]"
                    : "border-l-2 border-l-transparent",
            ].join(" ")}
        >
            <div className="flex items-start gap-3">
                <div
                    className={`w-8 h-8 rounded-full bg-gradient-to-br ${getAvatarGradient(reply.lead.id)} flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0 mt-0.5`}
                    aria-hidden="true"
                >
                    {getInitials(reply.lead.firstName ?? "", reply.lead.lastName ?? "")}
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
                            {reply.lead.firstName} {reply.lead.lastName}
                        </span>
                        <span className="text-[11px] text-[var(--text-muted)] flex-shrink-0 tabular-nums">
                            {formatTimeAgo(reply.createdAt)}
                        </span>
                    </div>

                    <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-xs text-[var(--text-muted)] truncate">
                            {reply.lead.companyName}
                        </span>
                        <span className={`text-[10px] font-semibold px-1.5 py-px rounded-full flex-shrink-0 ${cfg.badge}`}>
                            {cfg.label}
                        </span>
                        {reply.requiresHumanReview && (
                            <span className="text-[10px] font-semibold px-1.5 py-px rounded-full flex-shrink-0 bg-amber-400/10 border border-amber-400/20 text-amber-400">
                                ⚑ Review
                            </span>
                        )}
                    </div>

                    <p className="text-xs text-[var(--text-secondary)] line-clamp-2 leading-relaxed">
                        {reply.body}
                    </p>

                    {reply.sentimentScore !== null && (
                        <div className="mt-1.5">
                            <SentimentBar score={reply.sentimentScore ?? null} />
                        </div>
                    )}
                </div>
            </div>
        </button>
    );
}