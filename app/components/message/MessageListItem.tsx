import type { OutreachMessage } from "@/app/api/src/lib/message/messageHelper";

import { ApprovalBadge } from "./approval";
import { leadInitials, leadName, relativeTime } from "@/app/api/src/lib/message";

interface MessageListItemProps {
    message: OutreachMessage;
    selected: boolean;
    onClick: () => void;
}

export function MessageListItem({ message, selected, onClick }: MessageListItemProps) {
    const spamPct =
        message.spamRiskScore != null ? Math.round(message.spamRiskScore * 100) : null;
    const spamHigh = spamPct != null && spamPct >= 50;

    return (
        <button
            onClick={onClick}
            className={[
                "w-full text-left px-4 py-3.5 border-b border-slate-100 dark:border-slate-800 transition-all duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500",
                selected
                    ? "bg-violet-50 dark:bg-violet-950/30 border-l-2 border-l-violet-500"
                    : "hover:bg-slate-50 dark:hover:bg-slate-800/50 border-l-2 border-l-transparent",
            ].join(" ")}
            aria-pressed={selected}
        >
            <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-700 dark:to-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-600 dark:text-slate-300 flex-shrink-0 mt-0.5">
                    {leadInitials(message.lead)}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {leadName(message.lead)}
                        </span>
                        <span className="text-[10px] text-slate-400 flex-shrink-0 tabular-nums">
                            {relativeTime(message.createdAt)}
                        </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mb-1.5 truncate">
                        {message.lead.companyName}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate mb-2 leading-snug">
                        {message.subject}
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                        <ApprovalBadge status={message.approvalStatus} />
                        {spamPct != null && (
                            <span
                                className={[
                                    "text-[10px] font-medium px-1.5 py-0.5 rounded",
                                    spamHigh
                                        ? "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20"
                                        : "text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20",
                                ].join(" ")}
                            >
                                {spamHigh ? "⚠ " : ""}Spam {spamPct}%
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </button>
    );
}