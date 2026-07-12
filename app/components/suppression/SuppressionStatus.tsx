"use client";

import type { SuppressionStats } from "@/app/api/src/lib/suppression/types";

interface Props {
    stats: SuppressionStats | null;
    loading: boolean;
}

const STATS = [
    {
        key: "total" as const,
        label: "Total Blocked",
        accent: true,
        icon: (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
        ),
    },
    {
        key: "emailCount" as const,
        label: "Emails",
        accent: false,
        icon: (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
            </svg>
        ),
    },
    {
        key: "domainCount" as const,
        label: "Domains",
        accent: false,
        icon: (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
        ),
    },
];

export function SuppressionStatsBar({ stats, loading }: Props) {
    return (
        <div className="grid grid-cols-3 gap-3">
            {STATS.map((s) => (
                <div
                    key={s.key}
                    className={[
                        "rounded-xl border p-4 flex flex-col gap-3 bg-[var(--surface)]",
                        s.accent
                            ? "border-[var(--border-red)] ring-1 ring-[var(--red-glow)]"
                            : "border-[var(--border)]",
                    ].join(" ")}
                >
                    <div
                        className={[
                            "w-8 h-8 rounded-lg flex items-center justify-center",
                            s.accent
                                ? "bg-[var(--red-glow)] text-[var(--red)]"
                                : "bg-[var(--surface-2)] text-[var(--text-secondary)]",
                        ].join(" ")}
                    >
                        {s.icon}
                    </div>

                    {loading ? (
                        <div className="h-6 w-12 rounded bg-[var(--surface-2)] animate-pulse" />
                    ) : (
                        <p className="text-xl font-bold font-display tabular-nums text-[var(--text-primary)] leading-none">
                            {(stats?.[s.key] ?? 0).toLocaleString()}
                        </p>
                    )}

                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
                        {s.label}
                    </p>
                </div>
            ))}
        </div>
    );
}