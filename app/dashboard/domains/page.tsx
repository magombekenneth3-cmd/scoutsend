"use client";

import { useState, useEffect, useCallback } from "react";
import { TopBar } from "@/app/components/dashboard/TopBar";
import { DomainHealth, SenderDomain } from "@/app/api/src/lib/domains/domain.type";
import { fetchDomains, resetDailyCount, updateDomain } from "@/app/api/src/lib/domains/domainApi";
import { DomainCard } from "@/app/components/domains/DomainCard";
import { AddDomainSheet } from "@/app/components/domains/Adddomainsheet";
import { DomainDetailPanel } from "@/app/components/domains/DomaindetailPanel";

type HealthFilter = "ALL" | DomainHealth;

const HEALTH_FILTERS: { value: HealthFilter; label: string }[] = [
    { value: "ALL", label: "All" },
    { value: "HEALTHY", label: "Healthy" },
    { value: "WARNING", label: "Warning" },
    { value: "DEGRADED", label: "Degraded" },
    { value: "BLOCKED", label: "Blocked" },
];

function DomainCardSkeleton() {
    return (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4">
            <div className="flex items-start justify-between">
                <div className="space-y-2">
                    <div className="h-3.5 w-36 rounded bg-[var(--surface-2)] animate-pulse" />
                    <div className="h-2.5 w-20 rounded bg-[var(--surface-2)] animate-pulse" />
                </div>
                <div className="h-6 w-16 rounded-full bg-[var(--surface-2)] animate-pulse" />
            </div>
            <div className="h-1.5 w-full rounded-full bg-[var(--surface-2)] animate-pulse" />
            <div className="grid grid-cols-2 gap-2">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-3 rounded bg-[var(--surface-2)] animate-pulse" />
                ))}
            </div>
        </div>
    );
}

export default function DomainsPage() {

    const [domains, setDomains] = useState<SenderDomain[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [healthFilter, setHealthFilter] = useState<HealthFilter>("ALL");
    const [selectedDomain, setSelectedDomain] = useState<SenderDomain | null>(null);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const health = healthFilter === "ALL" ? undefined : healthFilter;
            const res = await fetchDomains(1, 100, health);
            setDomains(res.data);
        } catch (e) {
            setError("Failed to load sender domains. Check your API connection.");
        } finally {
            setLoading(false);
        }
    }, [healthFilter]);

    useEffect(() => { load(); }, [load]);

    async function handleToggleWarmup(domain: SenderDomain) {
        setActionLoading((p) => ({ ...p, [domain.id]: true }));
        try {
            const updated = await updateDomain(domain.id, { warmupEnabled: !domain.warmupEnabled });
            setDomains((prev) => prev.map((d) => (d.id === domain.id ? { ...d, ...updated } : d)));
            if (selectedDomain?.id === domain.id) setSelectedDomain((p) => p ? { ...p, ...updated } : p);
        } finally {
            setActionLoading((p) => ({ ...p, [domain.id]: false }));
        }
    }

    async function handleResetCount(domain: SenderDomain) {
        setActionLoading((p) => ({ ...p, [domain.id]: true }));
        try {
            const updated = await resetDailyCount(domain.id);
            setDomains((prev) => prev.map((d) => (d.id === domain.id ? { ...d, ...updated } : d)));
            if (selectedDomain?.id === domain.id) setSelectedDomain((p) => p ? { ...p, ...updated } : p);
        } finally {
            setActionLoading((p) => ({ ...p, [domain.id]: false }));
        }
    }

    function handleUpdated(updated: SenderDomain) {
        setDomains((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
        setSelectedDomain(updated);
    }

    function handleDeleted(id: string) {
        setDomains((prev) => prev.filter((d) => d.id !== id));
        setSelectedDomain(null);
    }

    function handleCreated(domain: SenderDomain) {
        setDomains((prev) => [domain, ...prev]);
        setSheetOpen(false);
        setSelectedDomain(domain);
    }

    const healthCounts = domains.reduce<Partial<Record<HealthFilter, number>>>((acc, d) => {
        acc[d.health] = (acc[d.health] ?? 0) + 1;
        acc["ALL"] = (acc["ALL"] ?? 0) + 1;
        return acc;
    }, { ALL: 0 });

    const blockedCount = domains.filter((d) => d.health === "BLOCKED").length;
    const warningCount = domains.filter((d) => d.health === "WARNING" || d.health === "DEGRADED").length;

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <TopBar
                title="Sender Domains"
                subtitle={loading ? "Loading…" : `${domains.length} domain${domains.length !== 1 ? "s" : ""} configured`}
                actions={
                    <button
                        onClick={() => setSheetOpen(true)}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-[var(--red)] text-white hover:bg-[var(--red-dim)] active:scale-[0.97] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        Add Domain
                    </button>
                }
            />

            {(blockedCount > 0 || warningCount > 0) && (
                <div className="mx-6 mt-4 flex items-start gap-2.5 p-3 bg-amber-400/5 border border-amber-400/20 rounded-xl">
                    <svg className="flex-shrink-0 mt-0.5 text-amber-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                        <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    <p className="text-xs text-amber-400">
                        {blockedCount > 0 && <span><strong>{blockedCount}</strong> blocked domain{blockedCount !== 1 ? "s" : ""}. </span>}
                        {warningCount > 0 && <span><strong>{warningCount}</strong> domain{warningCount !== 1 ? "s" : ""} with health issues. </span>}
                        Review and resolve to maintain deliverability.
                    </p>
                </div>
            )}

            <div className="flex items-center gap-1.5 px-6 py-4 flex-shrink-0">
                {HEALTH_FILTERS.filter((f) => f.value === "ALL" || (healthCounts[f.value] ?? 0) > 0).map((f) => (
                    <button
                        key={f.value}
                        onClick={() => setHealthFilter(f.value)}
                        className={[
                            "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]",
                            healthFilter === f.value
                                ? "bg-[var(--red-glow)] text-[var(--red)] border border-[var(--border-red)]"
                                : "bg-[var(--surface)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-red)]",
                        ].join(" ")}
                    >
                        {f.label}
                        {(healthCounts[f.value] ?? 0) > 0 && (
                            <span className="tabular-nums opacity-70">{healthCounts[f.value]}</span>
                        )}
                    </button>
                ))}

                <div className="flex-1" />

                <button
                    onClick={load}
                    aria-label="Refresh domains"
                    className="flex items-center justify-center w-8 h-8 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
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
                    >
                        <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                        <path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                    </svg>
                </button>
            </div>

            <div className="flex flex-1 overflow-hidden">
                <div className={[
                    "flex-1 overflow-y-auto px-6 pb-6 transition-all duration-200",
                    selectedDomain ? "pr-4" : "",
                ].join(" ")}>
                    {error ? (
                        <div className="flex flex-col items-center gap-3 py-16 text-center">
                            <div className="w-12 h-12 rounded-full bg-[var(--red-glow)] flex items-center justify-center">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="1.5">
                                    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                                </svg>
                            </div>
                            <p className="text-sm text-[var(--text-secondary)]">{error}</p>
                            <button onClick={load} className="text-xs text-[var(--red)] hover:underline">Retry</button>
                        </div>
                    ) : loading ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                            {Array.from({ length: 6 }).map((_, i) => <DomainCardSkeleton key={i} />)}
                        </div>
                    ) : domains.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
                            <div className="w-14 h-14 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-[var(--text-muted)]">
                                    <circle cx="12" cy="12" r="10" />
                                    <line x1="2" y1="12" x2="22" y2="12" />
                                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                                </svg>
                            </div>
                            <p className="text-sm font-semibold text-[var(--text-primary)]">
                                {healthFilter !== "ALL" ? `No ${healthFilter.toLowerCase()} domains` : "No sender domains yet"}
                            </p>
                            <p className="text-xs text-[var(--text-muted)] max-w-[240px]">
                                {healthFilter !== "ALL"
                                    ? "Try a different filter."
                                    : "Add a sending domain to begin warming up and sending outreach campaigns."}
                            </p>
                            {healthFilter === "ALL" && (
                                <button
                                    onClick={() => setSheetOpen(true)}
                                    className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-[var(--red)] text-white hover:bg-[var(--red-dim)] transition-colors"
                                >
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                                    </svg>
                                    Add Domain
                                </button>
                            )}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                            {domains.map((domain) => (
                                <DomainCard
                                    key={domain.id}
                                    domain={domain}
                                    onSelect={setSelectedDomain}
                                    onToggleWarmup={handleToggleWarmup}
                                    onResetCount={handleResetCount}
                                    loading={actionLoading[domain.id] ?? false}
                                />
                            ))}
                        </div>
                    )}
                </div>

                {selectedDomain && (
                    <div className="w-[360px] flex-shrink-0 overflow-hidden border-l border-[var(--border)]">
                        <DomainDetailPanel
                            domain={selectedDomain}
                            onClose={() => setSelectedDomain(null)}
                            onUpdated={handleUpdated}
                            onDeleted={handleDeleted}
                        />
                    </div>
                )}
            </div>

            <AddDomainSheet
                open={sheetOpen}
                onClose={() => setSheetOpen(false)}
                onCreated={handleCreated}
            />
        </div>
    );
}