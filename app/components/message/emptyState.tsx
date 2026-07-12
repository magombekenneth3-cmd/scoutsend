import type { ApprovalStatus } from "@/app/api/src/lib/message/messageHelper";

type FilterTab = ApprovalStatus | "ALL";

interface EmptyStateProps {
    filter: FilterTab;
}

const MESSAGES: Record<FilterTab, { title: string; body: string }> = {
    ALL: {
        title: "No messages yet",
        body: "Messages will appear here once the AI pipeline generates them.",
    },
    PENDING: {
        title: "Queue is clear",
        body: "All messages have been reviewed. Nice work.",
    },
    APPROVED: {
        title: "No approved messages",
        body: "Approved messages ready for sending will show here.",
    },
    REJECTED: {
        title: "No rejected messages",
        body: "Messages you've rejected for quality issues appear here.",
    },
};

export function EmptyState({ filter }: EmptyStateProps) {
    const { title, body } = MESSAGES[filter];

    return (
        <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center">
                <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-slate-400"
                >
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                </svg>
            </div>
            <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">
                    {title}
                </p>
                <p className="text-xs text-slate-400 max-w-[200px]">{body}</p>
            </div>
        </div>
    );
}