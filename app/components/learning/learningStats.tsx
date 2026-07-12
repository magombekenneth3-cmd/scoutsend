"use client";

import type { LearningEventStats } from "@/app/api/learning/learningApi";

interface LearningStatsBarProps {
    stats: LearningEventStats | null;
    loading: boolean;
    error: string | null;
}

function StatCard({
    label,
    value,
    accent,
    loading,
}: {
    label: string;
    value: string | number;
    accent?: boolean;
    loading: boolean;
}) {
    return (
        <div className="flex-1 min-w-0 bg-[var(--surface)] border border-[var(--border)] rounded-xl px-5 py-4">
            <p className="text-xs text-[var(--text-muted)] font-medium uppercase tracking-wider mb-2">
                {label}
            </p>
            {loading ? (
                <div className="h-7 w-16 rounded bg-[var(--surface-2)] animate-pulse" />
            ) : (
                <p
                    className={[
                        "text-2xl font-bold font-display tabular-nums",
                        accent ? "text-[var(--red)]" : "text-[var(--text-primary)]",
                    ].join(" ")}
                >
                    {value}
                </p>
            )}
        </div>
    );
}

export function LearningStatsBar({ stats, loading, error }: LearningStatsBarProps) {
    if (error) {
        return (
            <div
                role="alert"
                className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400"
            >
                {error}
            </div>
        );
    }

    return (
        <div className="flex gap-4" role="region" aria-label="Learning event statistics">
            <StatCard
                label="Total Events"
                value={stats?.totals.total ?? 0}
                loading={loading}
            />
            <StatCard
                label="Pending Review"
                value={stats?.totals.pending ?? 0}
                accent={(stats?.totals.pending ?? 0) > 0}
                loading={loading}
            />
            <StatCard
                label="Resolved"
                value={stats?.totals.resolved ?? 0}
                loading={loading}
            />
            <StatCard
                label="Edit Rate"
                value={stats?.totals.editRate ?? "0%"}
                loading={loading}
            />
        </div>
    );
}