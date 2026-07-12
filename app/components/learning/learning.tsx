"use client";

import type { LearningEvent } from "@/app/api/learning/learningApi";
import { LearningEventRow } from "@/app/components/learning/learningEventRow"

interface LearningTableProps {
    events: LearningEvent[];
    loading: boolean;
    error: string | null;
    selectedId: string | null;
    onSelect: (id: string) => void;
    page: number;
    totalPages: number;
    total: number;
    onPageChange: (page: number) => void;
}

function SkeletonRow() {
    return (
        <tr className="border-b border-[var(--border)]">
            {[2, 1, 3, 2, 2, 2].map((w, i) => (
                <td key={i} className="px-3 py-4">
                    <div
                        className={`h-4 rounded bg-[var(--surface-2)] animate-pulse w-${w * 8} max-w-full`}
                    />
                </td>
            ))}
        </tr>
    );
}

export function LearningTable({
    events,
    loading,
    error,
    selectedId,
    onSelect,
    page,
    totalPages,
    total,
    onPageChange,
}: LearningTableProps) {
    const btnClass = (active: boolean) =>
        [
            "flex items-center justify-center w-8 h-8 rounded-lg text-sm border transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]",
            active
                ? "border-[var(--red)] bg-[var(--red-glow)] text-[var(--red)]"
                : "border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-white/20 disabled:opacity-40 disabled:cursor-not-allowed",
        ].join(" ");

    return (
        <div className="flex flex-col min-h-0">
            <div className="overflow-auto flex-1 rounded-xl border border-[var(--border)]">
                <table
                    className="w-full border-collapse text-left"
                    aria-label="Learning events table"
                    aria-busy={loading}
                >
                    <thead>
                        <tr className="border-b border-[var(--border)] bg-[var(--surface)]">
                            <th className="pl-5 pr-3 py-3 w-2" aria-hidden="true" />
                            <th className="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                                Type
                            </th>
                            <th className="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                                Message / Lead
                            </th>
                            <th className="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                                Scores
                            </th>
                            <th className="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                                Outcome
                            </th>
                            <th className="px-3 pr-5 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                                Created
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading
                            ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
                            : error
                                ? (
                                    <tr>
                                        <td colSpan={6} className="px-5 py-10 text-center">
                                            <p className="text-sm text-red-400">{error}</p>
                                        </td>
                                    </tr>
                                )
                                : events.length === 0
                                    ? (
                                        <tr>
                                            <td colSpan={6} className="px-5 py-16 text-center">
                                                <div className="flex flex-col items-center gap-3">
                                                    <svg
                                                        width="32"
                                                        height="32"
                                                        viewBox="0 0 24 24"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        strokeWidth="1.25"
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                        className="text-[var(--text-muted)]"
                                                        aria-hidden="true"
                                                    >
                                                        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                                                        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                                                    </svg>
                                                    <p className="text-sm text-[var(--text-muted)]">
                                                        No learning events match the current filters
                                                    </p>
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                    : events.map((ev) => (
                                        <LearningEventRow
                                            key={ev.id}
                                            event={ev}
                                            selected={ev.id === selectedId}
                                            onSelect={() => onSelect(ev.id)}
                                        />
                                    ))}
                    </tbody>
                </table>
            </div>

            {!loading && !error && totalPages > 1 && (
                <div
                    className="flex items-center justify-between px-1 pt-3"
                    aria-label="Pagination"
                >
                    <p className="text-xs text-[var(--text-muted)] tabular-nums">
                        {total} event{total !== 1 ? "s" : ""}
                    </p>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => onPageChange(page - 1)}
                            disabled={page <= 1}
                            aria-label="Previous page"
                            className={btnClass(false)}
                        >
                            <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                            >
                                <polyline points="15 18 9 12 15 6" />
                            </svg>
                        </button>

                        {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                            const p = i + 1;
                            return (
                                <button
                                    key={p}
                                    onClick={() => onPageChange(p)}
                                    aria-label={`Page ${p}`}
                                    aria-current={page === p ? "page" : undefined}
                                    className={btnClass(page === p)}
                                >
                                    {p}
                                </button>
                            );
                        })}

                        <button
                            onClick={() => onPageChange(page + 1)}
                            disabled={page >= totalPages}
                            aria-label="Next page"
                            className={btnClass(false)}
                        >
                            <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                            >
                                <polyline points="9 18 15 12 9 6" />
                            </svg>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}