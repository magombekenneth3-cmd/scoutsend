"use client";

import { useState, useEffect, useCallback } from "react";

type DiscoveryRunStatus = "RUNNING" | "COMPLETED" | "FAILED" | "PARTIAL";
type DiscoverySourceType =
    | "APOLLO_SEARCH"
    | "SERPER_SEARCH"
    | "BUILTWITH_TECH"
    | "JOB_INTEL"
    | "COMMUNITY_INTENT"
    | "ENRICHMENT_REFRESH"
    | "LOOKALIKE"
    | "CSV_IMPORT";

interface DiscoveryRun {
    id: string;
    sourceType: DiscoverySourceType;
    status: DiscoveryRunStatus;
    companiesFound: number;
    leadsFound: number;
    signalsFound: number;
    errorMessage: string | null;
    startedAt: string;
    completedAt: string | null;
    query: string | null;
}

const SOURCE_LABELS: Record<DiscoverySourceType, string> = {
    APOLLO_SEARCH: "Apollo Search",
    SERPER_SEARCH: "Web Intelligence",
    BUILTWITH_TECH: "BuiltWith Tech",
    JOB_INTEL: "Job Intel",
    COMMUNITY_INTENT: "Community Intent",
    ENRICHMENT_REFRESH: "Enrichment Refresh",
    LOOKALIKE: "Lookalike",
    CSV_IMPORT: "CSV Import",
};

function StatusBadge({ status }: { status: DiscoveryRunStatus }) {
    const map: Record<DiscoveryRunStatus, { label: string; cls: string }> = {
        RUNNING: {
            label: "Running",
            cls: "bg-sky-400/10 text-sky-400 border-sky-400/20",
        },
        COMPLETED: {
            label: "Completed",
            cls: "bg-emerald-400/10 text-emerald-400 border-emerald-400/20",
        },
        PARTIAL: {
            label: "Partial",
            cls: "bg-amber-400/10 text-amber-400 border-amber-400/20",
        },
        FAILED: {
            label: "Failed",
            cls: "bg-red-400/10 text-red-400 border-red-400/20",
        },
    };
    const { label, cls } = map[status] ?? map.FAILED;
    return (
        <span
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full border ${cls}`}
        >
            {status === "RUNNING" && (
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" aria-hidden="true" />
            )}
            {label}
        </span>
    );
}

function duration(startedAt: string, completedAt: string | null): string {
    const end = completedAt ? new Date(completedAt) : new Date();
    const ms = end.getTime() - new Date(startedAt).getTime();
    if (ms < 1000) return `${ms}ms`;
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}m ${rem}s`;
}

function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60_000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

interface DiscoveryRunsPanelProps {
    campaignId: string;
}

export function DiscoveryRunsPanel({ campaignId }: DiscoveryRunsPanelProps) {
    const [runs, setRuns] = useState<DiscoveryRun[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchRuns = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/campaigns/${campaignId}/discovery-runs`, {
                cache: "no-store",
            });
            if (!res.ok) throw new Error(`Server error ${res.status}`);
            const data: DiscoveryRun[] = await res.json();
            setRuns(data);
        } catch {
            setError("Failed to load discovery history.");
        } finally {
            setLoading(false);
        }
    }, [campaignId]);

    useEffect(() => {
        fetchRuns();
    }, [fetchRuns]);

    return (
        <section aria-label="Discovery run history">
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
                    <div>
                        <h2 className="text-sm font-semibold font-display text-[var(--text-primary)]">
                            Discovery History
                        </h2>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            Last 20 discovery runs across all sources
                        </p>
                    </div>
                    <button
                        onClick={fetchRuns}
                        disabled={loading}
                        aria-label="Refresh discovery history"
                        className="flex items-center justify-center w-7 h-7 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        <svg
                            width="13"
                            height="13"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            className={loading ? "animate-spin" : ""}
                            aria-hidden="true"
                        >
                            <path d="M21 2v6h-6" />
                            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                            <path d="M3 22v-6h6" />
                            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                        </svg>
                    </button>
                </div>

                {error && (
                    <div
                        role="alert"
                        className="flex items-center gap-2 px-5 py-3 bg-red-400/5 border-b border-red-400/20"
                    >
                        <p className="text-xs text-red-400 flex-1">{error}</p>
                        <button
                            onClick={fetchRuns}
                            className="text-xs text-red-400 hover:underline focus-visible:outline-none"
                        >
                            Retry
                        </button>
                    </div>
                )}

                {loading ? (
                    <div className="divide-y divide-[var(--border)]" aria-hidden="true">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <div key={i} className="px-5 py-4 flex items-center gap-4">
                                <div className="h-3 w-28 rounded bg-[var(--surface-2)] animate-pulse" />
                                <div className="h-5 w-20 rounded-full bg-[var(--surface-2)] animate-pulse" />
                                <div className="ml-auto flex gap-6">
                                    {Array.from({ length: 3 }).map((_, j) => (
                                        <div key={j} className="h-3 w-10 rounded bg-[var(--surface-2)] animate-pulse" />
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : runs.length === 0 ? (
                    <div className="px-5 py-10 text-center">
                        <svg
                            width="28"
                            height="28"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="mx-auto text-[var(--text-muted)] mb-3"
                            aria-hidden="true"
                        >
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                        <p className="text-sm text-[var(--text-muted)]">No discovery runs yet.</p>
                        <p className="text-xs text-[var(--text-muted)] mt-1">
                            Run the pipeline to start discovering leads.
                        </p>
                    </div>
                ) : (
                    <div className="divide-y divide-[var(--border)]">
                        <div className="hidden sm:grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-x-6 px-5 py-2.5 text-xs text-[var(--text-muted)] uppercase tracking-widest font-medium">
                            <span>Source</span>
                            <span>Status</span>
                            <span className="text-right">Companies</span>
                            <span className="text-right">Leads</span>
                            <span className="text-right">Signals</span>
                            <span className="text-right">Duration</span>
                        </div>
                        {runs.map((run) => (
                            <div
                                key={run.id}
                                className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto_auto_auto] gap-x-6 gap-y-2 px-5 py-3.5 hover:bg-[var(--surface-2)] transition-colors duration-100"
                            >
                                <div className="min-w-0">
                                    <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                                        {SOURCE_LABELS[run.sourceType] ?? run.sourceType}
                                    </p>
                                    <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">
                                        {relativeTime(run.startedAt)}
                                        {run.query ? ` · ${run.query}` : ""}
                                    </p>
                                    {run.errorMessage && run.status === "FAILED" && (
                                        <p className="text-xs text-red-400 mt-1 truncate" title={run.errorMessage}>
                                            {run.errorMessage}
                                        </p>
                                    )}
                                </div>

                                <div className="flex sm:items-center">
                                    <StatusBadge status={run.status} />
                                </div>

                                <div className="hidden sm:flex sm:flex-col sm:items-end sm:justify-center">
                                    <span className="text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                                        {run.companiesFound.toLocaleString()}
                                    </span>
                                    <span className="text-xs text-[var(--text-muted)]">cos</span>
                                </div>

                                <div className="hidden sm:flex sm:flex-col sm:items-end sm:justify-center">
                                    <span className="text-sm font-semibold tabular-nums text-emerald-400">
                                        {run.leadsFound.toLocaleString()}
                                    </span>
                                    <span className="text-xs text-[var(--text-muted)]">leads</span>
                                </div>

                                <div className="hidden sm:flex sm:flex-col sm:items-end sm:justify-center">
                                    <span className="text-sm font-semibold tabular-nums text-sky-400">
                                        {run.signalsFound.toLocaleString()}
                                    </span>
                                    <span className="text-xs text-[var(--text-muted)]">signals</span>
                                </div>

                                <div className="hidden sm:flex sm:flex-col sm:items-end sm:justify-center">
                                    <span className="text-xs font-mono text-[var(--text-secondary)]">
                                        {duration(run.startedAt, run.completedAt)}
                                    </span>
                                </div>

                                <div className="sm:hidden flex items-center gap-4 text-xs text-[var(--text-muted)]">
                                    <span>
                                        <span className="font-semibold text-[var(--text-primary)]">
                                            {run.companiesFound}
                                        </span>{" "}
                                        cos
                                    </span>
                                    <span>
                                        <span className="font-semibold text-emerald-400">
                                            {run.leadsFound}
                                        </span>{" "}
                                        leads
                                    </span>
                                    <span>
                                        <span className="font-semibold text-sky-400">
                                            {run.signalsFound}
                                        </span>{" "}
                                        signals
                                    </span>
                                    <span className="ml-auto font-mono">
                                        {duration(run.startedAt, run.completedAt)}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
}
