"use client";

import type { RepliesMeta, RepliesTab, TabCounts } from "@/app/api/src/lib/reply/replyTypes";

interface RepliesSummaryStripProps {
    meta: RepliesMeta;
    tabCounts: TabCounts;
    activeTab: RepliesTab;
    onPageChange: (page: number) => void;
}

export function RepliesSummaryStrip({
    meta,
    tabCounts,
    activeTab,
    onPageChange,
}: RepliesSummaryStripProps) {
    const positiveCount = tabCounts.POSITIVE ?? 0;
    const meetingCount = tabCounts.MEETING_REQUEST ?? 0;
    const needsReviewCount = tabCounts.NEEDS_REVIEW ?? 0;

    return (
        <div className="flex items-center gap-6 px-6 py-3 border-b border-[var(--border)] bg-[var(--navy-mid)] flex-shrink-0">
            <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400" aria-hidden="true" />
                <span className="text-xs text-[var(--text-muted)]">
                    <span className="text-emerald-400 font-semibold tabular-nums">{positiveCount}</span> positive
                </span>
            </div>

            <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-400" aria-hidden="true" />
                <span className="text-xs text-[var(--text-muted)]">
                    <span className="text-blue-400 font-semibold tabular-nums">{meetingCount}</span> meeting requests
                </span>
            </div>

            {needsReviewCount > 0 && (
                <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" aria-hidden="true" />
                    <span className="text-xs text-[var(--text-muted)]">
                        <span className="text-amber-400 font-semibold tabular-nums">{needsReviewCount}</span> flagged for review
                    </span>
                </div>
            )}

            <div className="flex-1" />

            {meta.totalPages > 1 && (
                <nav aria-label="Pagination" className="flex items-center gap-2">
                    <span className="text-xs text-[var(--text-muted)] tabular-nums">
                        Page {meta.page} of {meta.totalPages}
                    </span>
                    <button
                        disabled={meta.page <= 1}
                        onClick={() => onPageChange(meta.page - 1)}
                        aria-label="Previous page"
                        className="w-6 h-6 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] disabled:opacity-30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="15 18 9 12 15 6" />
                        </svg>
                    </button>
                    <button
                        disabled={meta.page >= meta.totalPages}
                        onClick={() => onPageChange(meta.page + 1)}
                        aria-label="Next page"
                        className="w-6 h-6 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] disabled:opacity-30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="9 18 15 12 9 6" />
                        </svg>
                    </button>
                </nav>
            )}
        </div>
    );
}