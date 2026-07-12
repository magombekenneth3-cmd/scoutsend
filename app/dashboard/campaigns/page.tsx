"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CampaignBadge } from "../../components/dashboard/badges";
import { TopBar } from "../../components/dashboard/TopBar";
import type { CampaignStatus } from "../../components/dashboard/badges";
import { CampaignWizard } from "../../components/campaigns/campaignWizard";
import type { Campaign, SenderDomain } from "../../components/campaigns/campaignWizard";



type ActionState = "idle" | "loading" | "success" | "error";

function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60_000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

function Spinner({ size = 14 }: { size?: number }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            className="animate-spin"
        >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
    );
}

function SkeletonRow() {
    return (
        <tr className="border-b border-[var(--border)]">
            {[200, 80, 60, 60, 60, 120, 80].map((w, i) => (
                <td key={i} className="px-4 py-3">
                    <div
                        className="h-3 rounded animate-pulse bg-[var(--surface-2)]"
                        style={{ width: w }}
                    />
                </td>
            ))}
        </tr>
    );
}

interface DeleteDialogProps {
    campaign: Campaign | null;
    onClose: () => void;
    onDeleted: (id: string) => void;
}

function DeleteDialog({ campaign, onClose, onDeleted }: DeleteDialogProps) {
    const [status, setStatus] = useState<ActionState>("idle");
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (campaign) { setStatus("idle"); setError(null); }
    }, [campaign]);

    const dialogRef = React.useRef<HTMLDialogElement>(null);

    useEffect(() => {
        if (campaign) {
            dialogRef.current?.showModal();
        } else {
            dialogRef.current?.close();
        }
    }, [campaign]);

    async function handleDelete() {
        if (!campaign) return;
        setStatus("loading");
        try {
            const res = await fetch(`/api/campaigns/${campaign.id}`, {
                method: "DELETE",
            });
            if (!res.ok) {
                const d = await res.json().catch(() => ({}));
                throw new Error(d?.error ?? "Failed to delete");
            }
            setStatus("success");
            onDeleted(campaign.id);
        } catch (err) {
            setStatus("error");
            setError(err instanceof Error ? err.message : "Something went wrong");
        }
    }

    if (!campaign) return null;

    return (
        <dialog
            ref={dialogRef}
            onClose={onClose}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 w-full h-full max-w-full max-h-full outline-none backdrop:bg-black/60"
            aria-label="Confirm delete"
        >
            <div className="relative w-full max-w-sm bg-[var(--navy-mid)] border border-[var(--border)] rounded-2xl p-6 shadow-2xl">
                <div className="flex items-start gap-3 mb-4">
                    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[var(--red-glow)] flex items-center justify-center">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2" strokeLinecap="round">
                            <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                        </svg>
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Delete campaign?</h3>
                        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                            <span className="font-medium text-[var(--text-primary)]">{campaign.name}</span> will be soft-deleted. Leads and messages are preserved.
                        </p>
                    </div>
                </div>

                {error && (
                    <p className="mb-3 text-xs text-[var(--red)] bg-[var(--red-glow)] px-3 py-2 rounded-lg">{error}</p>
                )}

                <div className="flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 h-9 rounded-lg text-sm font-medium text-[var(--text-secondary)] bg-[var(--surface-2)] hover:bg-[var(--surface)] border border-[var(--border)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleDelete}
                        disabled={status === "loading"}
                        className="flex-1 h-9 rounded-lg text-sm font-semibold text-white bg-[var(--red)] hover:bg-[var(--red-dim)] active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-150 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        {status === "loading" ? <><Spinner size={12} /> Deleting…</> : "Delete"}
                    </button>
                </div>
            </div>
        </dialog>
    );
}

type StatusFilter = "ALL" | CampaignStatus;

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
    { value: "ALL", label: "All" },
    { value: "DRAFT", label: "Draft" },
    { value: "RESEARCHING", label: "Researching" },
    { value: "GENERATING", label: "Generating" },
    { value: "REVIEW", label: "Review" },
    { value: "SENDING", label: "Sending" },
    { value: "PAUSED", label: "Paused" },
    { value: "COMPLETED", label: "Completed" },
    { value: "FAILED", label: "Failed" },
];

export default function CampaignsPage() {
    const router = useRouter();
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [domains, setDomains] = useState<SenderDomain[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [toDelete, setToDelete] = useState<Campaign | null>(null);
    const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
    const [actionError, setActionError] = useState<Record<string, string>>({});
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
    const [search, setSearch] = useState("");

    const loadCampaigns = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const cRes = await fetch(`/api/campaigns`);
            if (cRes.status === 401) {
                router.replace("/auth/login");
                return;
            }
            if (!cRes.ok) {
                const errData = await cRes.json().catch(() => ({}));
                throw new Error(errData.error || `Failed to load campaigns (${cRes.status})`);
            }
            const cData = await cRes.json() as Campaign[];
            setCampaigns(cData);
        } catch (err: any) {
            setError(err.message || "Failed to load campaigns. Check your API connection.");
        } finally {
            setLoading(false);
        }
    }, [router]);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [cRes, dRes] = await Promise.all([
                fetch(`/api/campaigns`),
                fetch(`/api/sender-domains?limit=100`),
            ]);
            if (cRes.status === 401) {
                router.replace("/auth/login");
                return;
            }
            if (!cRes.ok) {
                const errData = await cRes.json().catch(() => ({}));
                throw new Error(errData.error || `Failed to load campaigns (${cRes.status})`);
            }
            if (!dRes.ok) {
                const errData = await dRes.json().catch(() => ({}));
                throw new Error(errData.error || `Failed to load sender domains (${dRes.status})`);
            }
            const [cData, dData] = await Promise.all([
                cRes.json() as Promise<Campaign[]>,
                dRes.json() as Promise<{ data: SenderDomain[] }>,
            ]);
            setCampaigns(cData);
            setDomains(dData.data ?? []);
        } catch (err: any) {
            setError(err.message || "Failed to load campaigns. Check your API connection.");
        } finally {
            setLoading(false);
        }
    }, [router]);

    useEffect(() => { load(); }, [load]);

    async function runAction(campaignId: string, action: "run" | "pause" | "resume") {
        setActionLoading((p) => ({ ...p, [campaignId]: true }));
        setActionError((p) => ({ ...p, [campaignId]: "" }));
        try {
            const res = await fetch(`/api/campaigns/${campaignId}/${action}`, {
                method: "POST",
            });
            if (!res.ok) {
                const d = await res.json().catch(() => ({}));
                setActionError((p) => ({ ...p, [campaignId]: d?.error ?? "Action failed" }));
                return;
            }
            await loadCampaigns();
        } finally {
            setActionLoading((p) => ({ ...p, [campaignId]: false }));
        }
    }

    const filtered = campaigns.filter((c) => {
        const matchStatus = statusFilter === "ALL" || c.status === statusFilter;
        const matchSearch = search.trim() === "" ||
            c.name.toLowerCase().includes(search.toLowerCase()) ||
            (c.targetIndustry?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
            (c.targetRegion?.toLowerCase().includes(search.toLowerCase()) ?? false);
        return matchStatus && matchSearch;
    });

    const counts = campaigns.reduce<Partial<Record<StatusFilter, number>>>((acc, c) => {
        const st = c.status as StatusFilter;
        acc[st] = (acc[st] ?? 0) + 1;
        acc["ALL"] = (acc["ALL"] ?? 0) + 1;
        return acc;
    }, { ALL: 0 });

    function handleCreated(c: Campaign) {
        setCampaigns((prev) => [c, ...prev]);
        setSheetOpen(false);
        router.push(`/dashboard/campaigns/${c.id}`);
    }

    function handleDeleted(id: string) {
        setCampaigns((prev) => prev.filter((c) => c.id !== id));
        setToDelete(null);
    }

    const activeCount = campaigns.filter((c) =>
        ["RESEARCHING", "GENERATING", "REVIEW", "SENDING"].includes(c.status)
    ).length;

    return (
        <div className="flex flex-col h-full">
            <TopBar
                title="Campaigns"
                subtitle={
                    loading
                        ? "Loading…"
                        : `${campaigns.length} total · ${activeCount} active`
                }
                actions={
                    <button
                        onClick={() => setSheetOpen(true)}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-[var(--red)] text-white hover:bg-[var(--red-dim)] active:scale-[0.97] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--navy-mid)]"
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        New Campaign
                    </button>
                }
            />

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
                {loading ? (
                    <>
                        <div className="flex flex-col sm:flex-row gap-3">
                            <div className="h-9 w-64 bg-[var(--surface)] border border-[var(--border)] rounded-lg animate-pulse" />
                        </div>
                        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left" aria-label="Loading table">
                                    <thead>
                                        <tr className="border-b border-[var(--border)]">
                                            {["Name", "Status", "Leads", "Limit/day", "Domain", "Created", "Actions"].map((col) => (
                                                <th key={col} className="px-4 py-3 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] whitespace-nowrap">{col}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </>
                ) : error ? (
                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                        <div className="flex flex-col items-center gap-3 py-16 text-center px-6">
                            <div className="w-12 h-12 rounded-full bg-[var(--red-glow)] flex items-center justify-center">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="1.5">
                                    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                                </svg>
                            </div>
                            <p className="text-sm text-[var(--text-secondary)]">{error}</p>
                            <button onClick={load} className="text-xs text-[var(--red)] hover:underline focus-visible:outline-none">Retry</button>
                        </div>
                    </div>
                ) : campaigns.length === 0 ? (
                    <div className="max-w-4xl mx-auto py-8 space-y-8 animate-fade-in">
                        <div className="text-center space-y-2">
                            <h2 className="text-xl md:text-2xl font-bold text-[var(--text-primary)] font-display tracking-tight">Welcome to ScoutSend! Let's get started.</h2>
                            <p className="text-sm text-[var(--text-secondary)] max-w-lg mx-auto">Follow these steps to configure your sending domains and launch your first AI-driven outreach campaign.</p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="bg-[var(--navy-mid)] border border-[var(--border)] rounded-2xl p-6 flex flex-col justify-between hover:border-[var(--border-red)] transition-all duration-200 shadow-lg group">
                                <div className="space-y-4">
                                    <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 group-hover:scale-110 transition-transform duration-200">
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /><path d="M6 21h12" /><path d="M12 17v4" />
                                        </svg>
                                    </div>
                                    <div className="space-y-1">
                                        <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">Step 1</span>
                                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Sender Domains</h3>
                                        <p className="text-xs text-[var(--text-muted)] leading-relaxed">Connect and authorize sending domains (SPF/DKIM/MX records) to secure email deliverability.</p>
                                    </div>
                                </div>
                                <div className="pt-6">
                                    {domains.length > 0 ? (
                                        <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold bg-emerald-400/10 px-3 py-1.5 rounded-lg border border-emerald-400/20 w-fit">
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="20 6 9 17 4 12" />
                                            </svg>
                                            Configured ({domains.length})
                                        </div>
                                    ) : (
                                        <Link
                                            href="/dashboard/domains"
                                            className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-red)] transition-colors"
                                        >
                                            Connect Domain
                                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                                            </svg>
                                        </Link>
                                    )}
                                </div>
                            </div>

                            <div className="bg-[var(--navy-mid)] border border-[var(--border)] rounded-2xl p-6 flex flex-col justify-between hover:border-[var(--border-red)] transition-all duration-200 shadow-lg group">
                                <div className="space-y-4">
                                    <div className="w-10 h-10 rounded-xl bg-[var(--red-glow)] border border-[var(--border-red)]/20 flex items-center justify-center text-[var(--red)] group-hover:scale-110 transition-transform duration-200">
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
                                        </svg>
                                    </div>
                                    <div className="space-y-1">
                                        <span className="text-[10px] font-bold text-[var(--red)] uppercase tracking-widest">Step 2</span>
                                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Create Campaign</h3>
                                        <p className="text-xs text-[var(--text-muted)] leading-relaxed">Specify your Ideal Customer Profile (ICP), target regions, and industries to guide the AI agent.</p>
                                    </div>
                                </div>
                                <div className="pt-6">
                                    <button
                                        onClick={() => setSheetOpen(true)}
                                        className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-[var(--red)] text-white hover:bg-[var(--red-dim)] transition-colors focus-visible:outline-none"
                                    >
                                        Launch Wizard
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                                        </svg>
                                    </button>
                                </div>
                            </div>

                            <div className="bg-[var(--navy-mid)] border border-[var(--border)] rounded-2xl p-6 flex flex-col justify-between hover:border-[var(--border-red)] transition-all duration-200 shadow-lg group opacity-85">
                                <div className="space-y-4">
                                    <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 group-hover:scale-110 transition-transform duration-200">
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
                                        </svg>
                                    </div>
                                    <div className="space-y-1">
                                        <span className="text-[10px] font-bold text-amber-400 uppercase tracking-widest">Step 3</span>
                                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">AI Auto-pilot</h3>
                                        <p className="text-xs text-[var(--text-muted)] leading-relaxed">The agent automatically discovers leads, enriches their profiles via PDL/Proxycurl, and drafts personalized sequences.</p>
                                    </div>
                                </div>
                                <div className="pt-6">
                                    <span className="text-xs font-semibold text-[var(--text-muted)] bg-[var(--surface-2)] px-2.5 py-1 rounded-lg border border-[var(--border)]">
                                        Pending Step 2
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="flex flex-col sm:flex-row gap-3">
                            <div className="relative flex-1 max-w-xs">
                                <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                                </svg>
                                <input
                                    type="search"
                                    placeholder="Search campaigns…"
                                    aria-label="Search campaigns"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className="w-full pl-9 pr-3 py-2 text-sm bg-[var(--surface)] border border-[var(--border)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-red)] focus:ring-1 focus:ring-[var(--red)]/20 transition-colors"
                                />
                            </div>

                            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 flex-shrink-0">
                                {STATUS_FILTERS.filter((f) => f.value === "ALL" || (counts[f.value] ?? 0) > 0).map((f) => (
                                    <button
                                        key={f.value}
                                        onClick={() => setStatusFilter(f.value)}
                                        className={[
                                            "flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]",
                                            statusFilter === f.value
                                                ? "bg-[var(--red-glow)] text-[var(--red)] border border-[var(--border-red)]"
                                                : "bg-[var(--surface)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-red)]",
                                        ].join(" ")}
                                    >
                                        {f.label}
                                        {(counts[f.value] ?? 0) > 0 && (
                                            <span className="tabular-nums opacity-70">{counts[f.value]}</span>
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left" aria-label="Campaigns table">
                                    <thead>
                                        <tr className="border-b border-[var(--border)]">
                                            {["Name", "Status", "Leads", "Limit/day", "Domain", "Created", "Actions"].map((col) => (
                                                <th
                                                    key={col}
                                                    scope="col"
                                                    className="px-4 py-3 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] whitespace-nowrap"
                                                >
                                                    {col}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filtered.map((c) => {
                                            const busy = actionLoading[c.id] ?? false;
                                            const canRun = ["DRAFT", "PAUSED"].includes(c.status);
                                            const canPause = ["SENDING", "REVIEWING", "GENERATING"].includes(c.status);
                                            const canResume = c.status === "PAUSED";
                                            const rowError = actionError[c.id];

                                            return (
                                                <tr
                                                    key={c.id}
                                                    className="group border-b border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors duration-100"
                                                >
                                                    <td className="px-4 py-3 max-w-[220px]">
                                                        <Link
                                                            href={`/dashboard/campaigns/${c.id}`}
                                                            className="text-sm font-medium text-[var(--text-primary)] hover:text-[var(--red)] transition-colors duration-150 focus-visible:outline-none focus-visible:underline truncate block"
                                                            title={c.name}
                                                        >
                                                            {c.name}
                                                        </Link>
                                                        {c.targetIndustry || c.targetRegion ? (
                                                            <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">
                                                                {[c.targetIndustry, c.targetRegion].filter(Boolean).join(" · ")}
                                                            </p>
                                                        ) : null}
                                                    </td>

                                                    <td className="px-4 py-3 whitespace-nowrap">
                                                        <CampaignBadge status={c.status as CampaignStatus} />
                                                    </td>

                                                    <td className="px-4 py-3 text-sm text-[var(--text-secondary)] tabular-nums">
                                                        {(c.leads ?? []).length.toLocaleString()}
                                                    </td>

                                                    <td className="px-4 py-3 text-sm text-[var(--text-secondary)] tabular-nums">
                                                        {c.dailySendLimit}
                                                    </td>

                                                    <td className="px-4 py-3">
                                                        {c.senderDomain ? (
                                                            <span className="text-xs text-[var(--text-secondary)] font-mono bg-[var(--surface-2)] px-2 py-0.5 rounded">
                                                                {c.senderDomain.domain}
                                                            </span>
                                                        ) : (
                                                            <span className="text-xs text-[var(--text-muted)]">—</span>
                                                        )}
                                                    </td>

                                                    <td className="px-4 py-3 text-xs text-[var(--text-muted)] whitespace-nowrap tabular-nums">
                                                        {timeAgo(c.createdAt)}
                                                    </td>

                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                                                            {canRun && (
                                                                <button
                                                                    onClick={() => runAction(c.id, "run")}
                                                                    disabled={busy}
                                                                    aria-label={`Run ${c.name}`}
                                                                    title="Run pipeline"
                                                                    className="flex items-center justify-center w-7 h-7 rounded-md text-[var(--text-secondary)] hover:text-emerald-400 hover:bg-emerald-400/10 disabled:opacity-40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                                                                >
                                                                    {busy ? <Spinner size={12} /> : (
                                                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                                                                            <polygon points="5 3 19 12 5 21 5 3" />
                                                                        </svg>
                                                                    )}
                                                                </button>
                                                            )}

                                                            {canPause && (
                                                                <button
                                                                    onClick={() => runAction(c.id, "pause")}
                                                                    disabled={busy}
                                                                    aria-label={`Pause ${c.name}`}
                                                                    title="Pause"
                                                                    className="flex items-center justify-center w-7 h-7 rounded-md text-[var(--text-secondary)] hover:text-amber-400 hover:bg-amber-400/10 disabled:opacity-40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                                                                >
                                                                    {busy ? <Spinner size={12} /> : (
                                                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                                                                            <rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" />
                                                                        </svg>
                                                                    )}
                                                                </button>
                                                            )}

                                                            {canResume && (
                                                                <button
                                                                    onClick={() => runAction(c.id, "resume")}
                                                                    disabled={busy}
                                                                    aria-label={`Resume ${c.name}`}
                                                                    title="Resume"
                                                                    className="flex items-center justify-center w-7 h-7 rounded-md text-[var(--text-secondary)] hover:text-sky-400 hover:bg-sky-400/10 disabled:opacity-40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                                                                >
                                                                    {busy ? <Spinner size={12} /> : (
                                                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                                                                            <polygon points="5 3 19 12 5 21 5 3" />
                                                                        </svg>
                                                                    )}
                                                                </button>
                                                            )}

                                                            <Link
                                                                href={`/dashboard/campaigns/${c.id}`}
                                                                aria-label={`View ${c.name}`}
                                                                title="View details"
                                                                className="flex items-center justify-center w-7 h-7 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                                                            >
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                                                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                                                                </svg>
                                                            </Link>

                                                            <button
                                                                onClick={() => setToDelete(c)}
                                                                aria-label={`Delete ${c.name}`}
                                                                title="Delete"
                                                                className="flex items-center justify-center w-7 h-7 rounded-md text-[var(--text-secondary)] hover:text-[var(--red)] hover:bg-[var(--red-glow)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                                                            >
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                                                    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" />
                                                                </svg>
                                                            </button>
                                                        </div>
                                                        {rowError && (
                                                            <p className="mt-1 text-xs text-[var(--red)] whitespace-nowrap">{rowError}</p>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>

                                {filtered.length === 0 && (
                                    <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                                        <div className="w-12 h-12 rounded-full bg-[var(--surface-2)] flex items-center justify-center text-[var(--text-muted)]">
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                                                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" />
                                            </svg>
                                        </div>
                                        <p className="text-sm font-medium text-[var(--text-secondary)]">No campaigns match your filters</p>
                                        <p className="text-xs text-[var(--text-muted)] max-w-[240px]">Try adjusting your search or status filter</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                )}
            </div>

            <CampaignWizard
                open={sheetOpen}
                domains={domains}
                onClose={() => setSheetOpen(false)}
                onCreated={handleCreated}
            />

            <DeleteDialog
                campaign={toDelete}
                onClose={() => setToDelete(null)}
                onDeleted={handleDeleted}
            />
        </div>
    );
}