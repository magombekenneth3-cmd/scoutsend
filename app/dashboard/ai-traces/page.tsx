"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/app/components/dashboard/TopBar";
import { deleteTrace, fetchTraces, fetchTraceStats } from "@/app/api/ai-traces/aitraceapi";
import { AITraceStatsBar } from "@/app/components/Aitrace/aitraceBar";
import { AITraceAgentBreakdown } from "@/app/components/Aitrace/AitraceBreakdown";
import { AITraceFilters } from "@/app/components/Aitrace/AitraceFilter";
import { AITraceRow } from "@/app/components/Aitrace/AitraceRows";
import { AITraceDetailPanel } from "@/app/components/Aitrace/aitraceDetailPanel";
import { AITrace, AITraceStats, TraceFilters } from "@/app/api/ai-traces/types";


const DEFAULT_FILTERS: TraceFilters = {
    agentName: "",
    model: "",
    minConfidence: "",
    maxConfidence: "",
    from: "",
    to: "",
    page: 1,
    limit: 20,
};

type PageState = "loading" | "forbidden" | "error" | "ready";

async function fetchCurrentUser(): Promise<{ role: string; firstName: string; lastName: string }> {
    const res = await fetch(`/api/auth/me`);
    if (res.status === 401) throw Object.assign(new Error("Unauthorized"), { status: 401 });
    if (!res.ok) throw new Error("Failed to fetch user");
    return res.json();
}

function TableSkeleton() {
    return (
        <>
            {Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-[var(--border)]">
                    {[120, 80, 60, 60, 100, 80, 30].map((w, j) => (
                        <td key={j} className="px-4 py-3">
                            <div className="h-3 rounded animate-pulse bg-[var(--surface-2)]" style={{ width: w }} />
                        </td>
                    ))}
                </tr>
            ))}
        </>
    );
}

function StatsSkeleton() {
    return (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 px-6 py-4 border-b border-[var(--border)] flex-shrink-0">
            {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-20 rounded-xl bg-[var(--surface-2)] animate-pulse" />
            ))}
        </div>
    );
}

function ForbiddenScreen() {
    const router = useRouter();
    return (
        <div className="flex-1 flex flex-col items-center justify-center px-8 py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-red-400/10 border border-red-400/20 flex items-center justify-center mb-6">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-red-400">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
            </div>
            <h2 className="text-base font-semibold text-[var(--text-primary)] mb-2">Admin access required</h2>
            <p className="text-sm text-[var(--text-secondary)] max-w-[320px] leading-relaxed mb-6">
                AI Traces are only visible to admins. Your current account does not have the required role.
            </p>
            <button
                onClick={() => router.push("/dashboard")}
                className="inline-flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-red)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
            >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
                Back to Dashboard
            </button>
        </div>
    );
}

function PageLoadingScreen() {
    return (
        <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
                <svg className="animate-spin text-[var(--red)]" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                <p className="text-sm text-[var(--text-muted)]">Verifying access…</p>
            </div>
        </div>
    );
}

export default function AITracesPage() {
    const router = useRouter();
    const [pageState, setPageState] = useState<PageState>("loading");
    const [traces, setTraces] = useState<AITrace[]>([]);
    const [stats, setStats] = useState<AITraceStats | null>(null);
    const [meta, setMeta] = useState({ total: 0, page: 1, limit: 20, totalPages: 1 });
    const [filters, setFilters] = useState<TraceFilters>(DEFAULT_FILTERS);
    const [loadingTraces, setLoadingTraces] = useState(false);
    const [loadingStats, setLoadingStats] = useState(false);
    const [tracesError, setTracesError] = useState<string | null>(null);
    const [selectedTrace, setSelectedTrace] = useState<AITrace | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [showBreakdown, setShowBreakdown] = useState(false);

    useEffect(() => {
        fetchCurrentUser()
            .then((user) => {
                if (user.role !== "ADMIN") {
                    setPageState("forbidden");
                } else {
                    setPageState("ready");
                }
            })
            .catch((err) => {
                if (err?.status === 401) {
                    router.replace("/auth/login");
                } else {
                    setPageState("error");
                }
            });
    }, [router]);

    const loadStats = useCallback(async () => {
        setLoadingStats(true);
        try {
            const s = await fetchTraceStats();
            setStats(s);
        } catch (e) {
            if ((e as { status?: number })?.status === 401) {
                router.replace("/auth/login");
            }
        } finally {
            setLoadingStats(false);
        }
    }, [router]);

    const loadTraces = useCallback(async (f: TraceFilters) => {
        setLoadingTraces(true);
        setTracesError(null);
        try {
            const res = await fetchTraces(f);
            setTraces(res.data);
            setMeta(res.meta);
        } catch (e) {
            const status = (e as { status?: number })?.status;
            if (status === 401) {
                router.replace("/auth/login");
                return;
            }
            if (status === 403) {
                setPageState("forbidden");
                return;
            }
            setTracesError("Failed to load AI traces. Check your API connection.");
        } finally {
            setLoadingTraces(false);
        }
    }, [router]);

    useEffect(() => {
        if (pageState !== "ready") return;
        loadStats();
    }, [pageState, loadStats]);

    useEffect(() => {
        if (pageState !== "ready") return;
        loadTraces(filters);
        setSelectedTrace(null);
    }, [pageState, filters, loadTraces]);

    async function handleDelete(id: string) {
        setDeletingId(id);
        try {
            await deleteTrace(id);
            setTraces((prev) => prev.filter((t) => t.id !== id));
            if (selectedTrace?.id === id) setSelectedTrace(null);
            setMeta((m) => ({ ...m, total: Math.max(0, m.total - 1) }));
            setStats((s) => s ? {
                ...s,
                totals: { ...s.totals, count: Math.max(0, s.totals.count - 1) },
            } : s);
        } catch (e) {
            console.error("[delete trace]", e);
        } finally {
            setDeletingId(null);
        }
    }

    function changePage(page: number) {
        setFilters((f) => ({ ...f, page }));
    }

    const agentNames = stats?.byAgent.map((a) => a.agentName) ?? [];
    const models = stats?.byModel.map((m) => m.model) ?? [];

    if (pageState === "loading") {
        return (
            <div className="flex flex-col h-full">
                <TopBar title="AI Traces" subtitle="Loading…" />
                <PageLoadingScreen />
            </div>
        );
    }

    if (pageState === "forbidden") {
        return (
            <div className="flex flex-col h-full">
                <TopBar title="AI Traces" subtitle="Admin only" />
                <ForbiddenScreen />
            </div>
        );
    }

    if (pageState === "error") {
        return (
            <div className="flex flex-col h-full">
                <TopBar title="AI Traces" subtitle="Error" />
                <div className="flex-1 flex items-center justify-center">
                    <div className="text-center space-y-3">
                        <p className="text-sm text-[var(--text-secondary)]">Failed to verify your session.</p>
                        <button onClick={() => router.refresh()} className="text-xs text-[var(--red)] hover:underline">Try again</button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <TopBar
                title="AI Traces"
                subtitle={loadingTraces ? "Loading…" : `${meta.total.toLocaleString()} trace${meta.total !== 1 ? "s" : ""}`}
                actions={
                    <div className="flex items-center gap-2">
                        {stats && (
                            <button
                                onClick={() => setShowBreakdown((v) => !v)}
                                className={[
                                    "inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]",
                                    showBreakdown
                                        ? "bg-[var(--red-glow)] border-[var(--border-red)] text-[var(--red)]"
                                        : "bg-[var(--surface)] border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                                ].join(" ")}
                            >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                    <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
                                </svg>
                                Breakdown
                            </button>
                        )}
                        <button
                            onClick={() => { loadTraces(filters); loadStats(); }}
                            aria-label="Refresh"
                            className="flex items-center justify-center w-8 h-8 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                        >
                            <svg
                                width="13" height="13" viewBox="0 0 24 24" fill="none"
                                stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                                className={loadingTraces || loadingStats ? "animate-spin" : ""}
                            >
                                <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                                <path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                            </svg>
                        </button>
                    </div>
                }
            />

            {loadingStats && !stats ? <StatsSkeleton /> : stats ? <AITraceStatsBar stats={stats} /> : null}

            {showBreakdown && stats && (
                <AITraceAgentBreakdown byAgent={stats.byAgent} byModel={stats.byModel} />
            )}

            {stats && stats.lowConfidenceTraces.length > 0 && (
                <div className="mx-6 mt-3 inline-flex self-start items-center gap-2 px-3 py-1.5 bg-amber-400/5 rounded-full flex-shrink-0">
                    <svg className="flex-shrink-0 text-amber-400" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                        <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    <p className="text-xs text-amber-400">
                        <strong>{stats.lowConfidenceTraces.length}</strong> trace{stats.lowConfidenceTraces.length !== 1 ? "s" : ""} below 50% confidence.{" "}
                        <button
                            onClick={() => setFilters((f) => ({ ...f, maxConfidence: "0.5", page: 1 }))}
                            className="underline hover:no-underline focus-visible:outline-none"
                        >
                            Filter
                        </button>
                    </p>
                </div>
            )}

            <AITraceFilters
                filters={filters}
                agentNames={agentNames}
                models={models}
                onChange={(f) => setFilters(f)}
                onReset={() => setFilters(DEFAULT_FILTERS)}
            />

            <div className="flex flex-1 overflow-hidden">
                <div className={["flex-1 overflow-y-auto transition-all duration-200", selectedTrace ? "border-r border-[var(--border)]" : ""].join(" ")}>
                    {tracesError ? (
                        <div className="flex flex-col items-center gap-3 py-16 text-center px-6">
                            <div className="w-12 h-12 rounded-xl bg-red-400/10 flex items-center justify-center">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="text-red-400">
                                    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                                </svg>
                            </div>
                            <p className="text-sm text-[var(--text-secondary)]">{tracesError}</p>
                            <button onClick={() => loadTraces(filters)} className="text-xs text-[var(--red)] hover:underline focus-visible:outline-none">Retry</button>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left" aria-label="AI traces">
                                <thead>
                                    <tr className="border-b border-[var(--border)] sticky top-0 bg-[var(--navy-mid)] z-10">
                                        {["Agent", "Model", "Latency", "Tokens", "Confidence", "When", ""].map((col) => (
                                            <th key={col} scope="col" className="px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)] whitespace-nowrap">
                                                {col}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {loadingTraces ? (
                                        <TableSkeleton />
                                    ) : traces.length === 0 ? (
                                        <tr>
                                            <td colSpan={7} className="px-4 py-20 text-center">
                                                <div className="flex flex-col items-center gap-3">
                                                    <div className="w-12 h-12 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center">
                                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--text-muted)]">
                                                            <circle cx="12" cy="12" r="3" /><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
                                                        </svg>
                                                    </div>
                                                    <p className="text-sm font-medium text-[var(--text-secondary)]">No traces found</p>
                                                    <p className="text-xs text-[var(--text-muted)] max-w-[240px]">
                                                        Traces are written automatically when the AI pipeline runs. Try clearing your filters.
                                                    </p>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : (
                                        traces.map((trace) => (
                                            <AITraceRow
                                                key={trace.id}
                                                trace={trace}
                                                selected={selectedTrace?.id === trace.id}
                                                onSelect={() => setSelectedTrace(selectedTrace?.id === trace.id ? null : trace)}
                                                onDelete={handleDelete}
                                                deleting={deletingId === trace.id}
                                            />
                                        ))
                                    )}
                                </tbody>
                            </table>

                            {!loadingTraces && meta.totalPages > 1 && (
                                <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)] bg-[var(--navy-mid)]">
                                    <p className="text-xs text-[var(--text-muted)] tabular-nums">
                                        {((meta.page - 1) * meta.limit + 1).toLocaleString()}–{Math.min(meta.page * meta.limit, meta.total).toLocaleString()} of {meta.total.toLocaleString()}
                                    </p>
                                    <nav aria-label="Pagination" className="flex items-center gap-1">
                                        <button
                                            disabled={meta.page <= 1}
                                            onClick={() => changePage(meta.page - 1)}
                                            aria-label="Previous page"
                                            className="w-7 h-7 flex items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] disabled:opacity-30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                                        >
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
                                        </button>

                                        {(() => {
                                            const total = meta.totalPages;
                                            const current = meta.page;
                                            const windowSize = 5;
                                            let start = Math.max(1, current - Math.floor(windowSize / 2));
                                            let end = start + windowSize - 1;
                                            if (end > total) { end = total; start = Math.max(1, end - windowSize + 1); }

                                            return Array.from({ length: end - start + 1 }, (_, i) => start + i).map((page) => (
                                                <button
                                                    key={page}
                                                    onClick={() => changePage(page)}
                                                    aria-current={page === current ? "page" : undefined}
                                                    className={[
                                                        "w-7 h-7 flex items-center justify-center rounded-md text-xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]",
                                                        page === current
                                                            ? "bg-[var(--red)] text-white font-semibold"
                                                            : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)]",
                                                    ].join(" ")}
                                                >
                                                    {page}
                                                </button>
                                            ));
                                        })()}

                                        <button
                                            disabled={meta.page >= meta.totalPages}
                                            onClick={() => changePage(meta.page + 1)}
                                            aria-label="Next page"
                                            className="w-7 h-7 flex items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] disabled:opacity-30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                                        >
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
                                        </button>
                                    </nav>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {selectedTrace && (
                    <div className="w-[400px] flex-shrink-0 overflow-hidden">
                        <AITraceDetailPanel
                            trace={selectedTrace}
                            onClose={() => setSelectedTrace(null)}
                        />
                    </div>
                )}

                {!selectedTrace && !loadingTraces && traces.length > 0 && (
                    <div className="hidden lg:flex w-[220px] flex-shrink-0 flex-col gap-4 px-5 py-6 border-l border-[var(--border)]">
                        <div>
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1">Overview</p>
                            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                                {stats ? `${stats.totals.count.toLocaleString()} traces tracked` : "Select a trace to inspect prompt, response and metadata."}
                            </p>
                        </div>

                        {stats && stats.byAgent.length > 0 && (
                            <div>
                                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-2">Top agents</p>
                                <div className="space-y-1.5">
                                    {stats.byAgent.slice(0, 4).map((a) => (
                                        <div key={a.agentName} className="flex items-center justify-between text-xs">
                                            <span className="text-[var(--text-secondary)] truncate">{a.agentName}</span>
                                            <span className="text-[var(--text-muted)] tabular-nums ml-2">{a._count.id}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {stats && stats.lowConfidenceTraces.length > 0 && (
                            <div>
                                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1">Needs review</p>
                                <p className="text-xs text-amber-400">
                                    {stats.lowConfidenceTraces.length} low-confidence trace{stats.lowConfidenceTraces.length !== 1 ? "s" : ""}
                                </p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}