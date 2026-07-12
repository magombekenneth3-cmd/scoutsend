"use client";

import { useState, useEffect, useCallback } from "react";
import { TopBar } from "@/app/components/dashboard/TopBar";
import { DomainHealth } from "@/app/api/src/lib/domains/domain.type";
import { SenderMailbox } from "@/app/api/mailbox/Mailbox.Types";
import { fetchMailboxes, updateMailbox, resetMailboxDailyCount } from "@/app/api/mailbox/mailboxapi";
import { MailboxCard } from "@/app/components/mailboxes/MailboxCard";
import { AddMailboxSheet } from "@/app/components/mailboxes/AddMailboxSheet";
import { MailboxDetailPanel } from "@/app/components/mailboxes/MailboxDetailPanel";

type HealthFilter = "ALL" | DomainHealth;
type ProviderFilter = "ALL" | "GMAIL" | "OUTLOOK" | "SMTP";

const HEALTH_FILTERS: { value: HealthFilter; label: string }[] = [
    { value: "ALL", label: "All" },
    { value: "HEALTHY", label: "Healthy" },
    { value: "WARNING", label: "Warning" },
    { value: "DEGRADED", label: "Degraded" },
    { value: "BLOCKED", label: "Blocked" },
];

const PROVIDER_FILTERS: { value: ProviderFilter; label: string }[] = [
    { value: "ALL", label: "All providers" },
    { value: "GMAIL", label: "Gmail" },
    { value: "OUTLOOK", label: "Outlook" },
    { value: "SMTP", label: "SMTP" },
];

function MailboxCardSkeleton() {
    return (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4">
            <div className="flex items-start justify-between">
                <div className="space-y-2">
                    <div className="h-3.5 w-36 rounded bg-[var(--surface-2)] animate-pulse" />
                    <div className="h-2.5 w-28 rounded bg-[var(--surface-2)] animate-pulse" />
                    <div className="h-2.5 w-20 rounded bg-[var(--surface-2)] animate-pulse" />
                </div>
                <div className="h-6 w-16 rounded-full bg-[var(--surface-2)] animate-pulse" />
            </div>
            <div className="space-y-1.5">
                <div className="flex justify-between">
                    <div className="h-2.5 w-16 rounded bg-[var(--surface-2)] animate-pulse" />
                    <div className="h-2.5 w-12 rounded bg-[var(--surface-2)] animate-pulse" />
                </div>
                <div className="h-1.5 w-full rounded-full bg-[var(--surface-2)] animate-pulse" />
            </div>
            <div className="grid grid-cols-2 gap-2">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-3 rounded bg-[var(--surface-2)] animate-pulse" />
                ))}
            </div>
        </div>
    );
}

export default function MailboxesPage() {
    const [mailboxes, setMailboxes] = useState<SenderMailbox[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [healthFilter, setHealthFilter] = useState<HealthFilter>("ALL");
    const [providerFilter, setProviderFilter] = useState<ProviderFilter>("ALL");
    const [selectedMailbox, setSelectedMailbox] = useState<SenderMailbox | null>(null);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const health = healthFilter === "ALL" ? undefined : healthFilter;
            const provider = providerFilter === "ALL" ? undefined : providerFilter;
            const res = await fetchMailboxes(1, 100, { health, providerType: provider });
            setMailboxes(res.data);
        } catch {
            setError("Failed to load sender mailboxes. Check your API connection.");
        } finally {
            setLoading(false);
        }
    }, [healthFilter, providerFilter]);

    useEffect(() => { load(); }, [load]);

    async function handleToggleWarmup(mailbox: SenderMailbox) {
        setActionLoading((p) => ({ ...p, [mailbox.id]: true }));
        try {
            const updated = await updateMailbox(mailbox.id, { warmupEnabled: !mailbox.warmupEnabled });
            const m = updated as unknown as SenderMailbox;
            setMailboxes((prev) => prev.map((x) => x.id === mailbox.id ? { ...x, ...m } : x));
            if (selectedMailbox?.id === mailbox.id) setSelectedMailbox((p) => p ? { ...p, ...m } : p);
        } finally {
            setActionLoading((p) => ({ ...p, [mailbox.id]: false }));
        }
    }

    async function handleResetCount(mailbox: SenderMailbox) {
        setActionLoading((p) => ({ ...p, [mailbox.id]: true }));
        try {
            const updated = await resetMailboxDailyCount(mailbox.id);
            const m = updated as unknown as SenderMailbox;
            setMailboxes((prev) => prev.map((x) => x.id === mailbox.id ? { ...x, ...m } : x));
            if (selectedMailbox?.id === mailbox.id) setSelectedMailbox((p) => p ? { ...p, ...m } : p);
        } finally {
            setActionLoading((p) => ({ ...p, [mailbox.id]: false }));
        }
    }

    function handleUpdated(updated: SenderMailbox) {
        setMailboxes((prev) => prev.map((x) => x.id === updated.id ? updated : x));
        setSelectedMailbox(updated);
    }

    function handleDeleted(id: string) {
        setMailboxes((prev) => prev.filter((x) => x.id !== id));
        setSelectedMailbox(null);
    }

    function handleCreated(mailbox: SenderMailbox) {
        setMailboxes((prev) => [mailbox, ...prev]);
        setSheetOpen(false);
        setSelectedMailbox(mailbox);
    }

    const healthCounts = mailboxes.reduce<Partial<Record<HealthFilter, number>>>((acc, m) => {
        acc[m.health] = (acc[m.health] ?? 0) + 1;
        acc["ALL"] = (acc["ALL"] ?? 0) + 1;
        return acc;
    }, { ALL: 0 });

    const blockedCount = mailboxes.filter((m) => m.health === "BLOCKED").length;
    const warningCount = mailboxes.filter((m) => m.health === "WARNING" || m.health === "DEGRADED").length;
    const totalSentToday = mailboxes.reduce((sum, m) => sum + m.currentSent, 0);
    const totalCapacity = mailboxes.reduce((sum, m) => sum + m.dailyLimit, 0);

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <TopBar
                title="Sender Mailboxes"
                subtitle={
                    loading
                        ? "Loading…"
                        : `${mailboxes.length} mailbox${mailboxes.length !== 1 ? "es" : ""}${mailboxes.length > 0 ? ` · ${totalSentToday.toLocaleString()} / ${totalCapacity.toLocaleString()} sent today` : ""}`
                }
                actions={
                    <button
                        onClick={() => setSheetOpen(true)}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-[var(--red)] text-white hover:bg-[var(--red-dim)] active:scale-[0.97] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        Add Mailbox
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
                        {blockedCount > 0 && <span><strong>{blockedCount}</strong> blocked mailbox{blockedCount !== 1 ? "es" : ""}. </span>}
                        {warningCount > 0 && <span><strong>{warningCount}</strong> mailbox{warningCount !== 1 ? "es" : ""} with health issues. </span>}
                        Review and resolve to maintain deliverability.
                    </p>
                </div>
            )}

            <div className="flex items-center gap-1.5 px-6 py-4 flex-shrink-0 flex-wrap">
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

                <div className="w-px h-4 bg-[var(--border)] mx-1" />

                <select
                    value={providerFilter}
                    onChange={(e) => setProviderFilter(e.target.value as ProviderFilter)}
                    className="h-[30px] bg-[var(--surface)] border border-[var(--border)] rounded-lg text-xs text-[var(--text-secondary)] px-2 pr-6 appearance-none focus:outline-none focus:border-[var(--border-red)] transition-colors cursor-pointer"
                    style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5' stroke-linecap='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center" }}
                >
                    {PROVIDER_FILTERS.map((f) => (
                        <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                </select>

                <div className="flex-1" />

                <button
                    onClick={load}
                    aria-label="Refresh mailboxes"
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
                    selectedMailbox ? "pr-4" : "",
                ].join(" ")}>
                    {error ? (
                        <div className="flex flex-col items-center gap-3 py-16 text-center">
                            <div className="w-12 h-12 rounded-full bg-[var(--red-glow)] flex items-center justify-center">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="1.5">
                                    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                                </svg>
                            </div>
                            <p className="text-sm text-[var(--text-secondary)]">{error}</p>
                            <button onClick={load} className="text-xs text-[var(--red)] hover:underline focus-visible:outline-none focus-visible:underline">Retry</button>
                        </div>
                    ) : loading ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                            {Array.from({ length: 6 }).map((_, i) => <MailboxCardSkeleton key={i} />)}
                        </div>
                    ) : mailboxes.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
                            <div className="w-14 h-14 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-[var(--text-muted)]">
                                    <rect x="2" y="4" width="20" height="16" rx="2" />
                                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                                </svg>
                            </div>
                            <p className="text-sm font-semibold text-[var(--text-primary)]">
                                {healthFilter !== "ALL" || providerFilter !== "ALL"
                                    ? "No mailboxes match this filter"
                                    : "No sender mailboxes yet"}
                            </p>
                            <p className="text-xs text-[var(--text-muted)] max-w-[260px]">
                                {healthFilter !== "ALL" || providerFilter !== "ALL"
                                    ? "Try a different filter."
                                    : "Connect a Gmail, Outlook, or SMTP mailbox to start sending outreach campaigns."}
                            </p>
                            {healthFilter === "ALL" && providerFilter === "ALL" && (
                                <button
                                    onClick={() => setSheetOpen(true)}
                                    className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-[var(--red)] text-white hover:bg-[var(--red-dim)] transition-colors"
                                >
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                                    </svg>
                                    Add Mailbox
                                </button>
                            )}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                            {mailboxes.map((mailbox) => (
                                <MailboxCard
                                    key={mailbox.id}
                                    mailbox={mailbox}
                                    onSelect={setSelectedMailbox}
                                    onToggleWarmup={handleToggleWarmup}
                                    onResetCount={handleResetCount}
                                    loading={actionLoading[mailbox.id] ?? false}
                                />
                            ))}
                        </div>
                    )}
                </div>

                {selectedMailbox && (
                    <div className="w-[360px] flex-shrink-0 overflow-hidden border-l border-[var(--border)]">
                        <MailboxDetailPanel
                            mailbox={selectedMailbox}
                            onClose={() => setSelectedMailbox(null)}
                            onUpdated={handleUpdated}
                            onDeleted={handleDeleted}
                        />
                    </div>
                )}
            </div>

            <AddMailboxSheet
                open={sheetOpen}
                onClose={() => setSheetOpen(false)}
                onCreated={handleCreated}
            />
        </div>
    );
}
