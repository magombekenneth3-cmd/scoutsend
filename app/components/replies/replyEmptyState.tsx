import { INTENT_TABS } from "@/app/api/src/lib/reply/replyConfig";
import { RepliesTab } from "@/app/api/src/lib/reply/replyTypes";

interface RepliesEmptyStateProps {
    tab: RepliesTab;
}

export function RepliesEmptyState({ tab }: RepliesEmptyStateProps) {
    const tabLabel = INTENT_TABS.find((t) => t.id === tab)?.label ?? tab;

    const message =
        tab === "NEEDS_REVIEW"
            ? "No replies flagged for human review right now."
            : tab === "ALL"
                ? "Replies will appear here once prospects start responding."
                : `No ${tabLabel} replies yet.`;

    return (
        <div className="flex flex-col items-center justify-center h-full py-20 px-8 text-center">
            <div className="w-14 h-14 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center mb-5">
                <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-[var(--text-muted)]"
                    aria-hidden="true"
                >
                    <polyline points="9 17 4 12 9 7" />
                    <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
                </svg>
            </div>
            <p className="text-sm font-semibold text-[var(--text-primary)] mb-1.5">No replies yet</p>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed max-w-[220px]">{message}</p>
        </div>
    );
}