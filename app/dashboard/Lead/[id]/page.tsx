"use client";

import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from "react";
import { useParams, useSearchParams, useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { CampaignBadge } from "@/app/components/dashboard/badges";
import { PipelineTab } from "@/app/components/dashboard/Pipeline";
import { LeadsTab } from "@/app/components/dashboard/LeadsTab";
import { MessagesTab } from "@/app/components/dashboard/MessageTab";
import { DeliverabilityTab } from "@/app/components/dashboard/DeliverabilityTab";
import { DiscoveryRunsPanel } from "@/app/components/dashboard/DiscoveryRunsPanel";
import { SignalsTab } from "@/app/components/dashboard/SignalsTab";
import { SequenceTab } from "@/app/components/dashboard/SequenceTab";
import { ICPSearch } from "@/app/components/dashboard/IcpSearch";
import type { CampaignStatus } from "@/app/components/dashboard/badges";

const CampaignNarrativeLazy = lazy(() =>
    import("@/app/components/dashboard/CampaignNarrative").then((m) => ({
        default: m.CampaignNarrative,
    }))
);

export type Tab = "pipeline" | "leads" | "prospects" | "messages" | "deliverability" | "discovery" | "signals" | "sequence";

const PAUSABLE_STATUSES = [
    "SENDING", "QUEUED", "GENERATING", "RESEARCHING", "REVIEW",
] as const satisfies readonly CampaignStatus[];

const POLLING_STATUSES = [
    "QUEUED", "RESEARCHING", "GENERATING", "REVIEW", "SENDING",
] as const satisfies readonly CampaignStatus[];

interface Campaign {
    id: string;
    name: string;
    description: string | null;
    status: CampaignStatus;
    icpDescription: string | null;
    targetIndustry: string | null;
    targetRegion: string | null;
    dailySendLimit: number | null;
    senderDomain: string | null;
    leads: { id: string }[];
    _count?: { leads: number };
    createdAt: string;
    updatedAt: string;
}

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    {
        id: "pipeline",
        label: "Pipeline",
        icon: (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
        ),
    },
    {
        id: "leads",
        label: "Leads",
        icon: (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
        ),
    },
    {
        id: "prospects",
        label: "Prospects",
        icon: (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <path d="M11 8v3l2 2" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
        ),
    },
    {
        id: "messages",
        label: "Messages",
        icon: (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
            </svg>
        ),
    },
    {
        id: "deliverability",
        label: "Deliverability",
        icon: (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
        ),
    },
    {
        id: "discovery",
        label: "Discovery",
        icon: (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
        ),
    },
    {
        id: "signals",
        label: "Signals",
        icon: (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
        ),
    },
    {
        id: "sequence",
        label: "Sequence",
        icon: (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
        ),
    },
];

async function apiRequest(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}

export default function CampaignDetailPage() {
    const params = useParams();
    const id = typeof params.id === "string" ? params.id : "";

    const [campaign, setCampaign] = useState<Campaign | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const searchParams = useSearchParams();
    const pathname = usePathname();
    const router = useRouter();
    const activeTab = (searchParams.get("tab") as Tab | null) ?? "pipeline";

    function setActiveTab(tab: Tab) {
        const p = new URLSearchParams(searchParams.toString());
        p.set("tab", tab);
        router.replace(`${pathname}?${p.toString()}`, { scroll: false });
    }

    const [isPausing, setIsPausing] = useState(false);
    const [isActioning, setIsActioning] = useState(false);

    const mounted = useRef(true);
    useEffect(() => { return () => { mounted.current = false; }; }, []);

    const fetchCampaign = useCallback(async (signal?: AbortSignal) => {
        try {
            const res = await fetch(`/api/campaigns/${id}`, { cache: "no-store", signal });
            if (res.status === 404) {
                if (mounted.current) { setError("Campaign not found."); setLoading(false); }
                return;
            }
            if (!res.ok) throw new Error(`Server error ${res.status}`);
            const data: Campaign = await res.json();
            if (mounted.current) { setError(null); setCampaign(data); }
        } catch (err) {
            if (err instanceof DOMException && err.name === "AbortError") return;
            if (mounted.current) setError(err instanceof Error ? err.message : "Failed to load campaign.");
        } finally {
            if (mounted.current) setLoading(false);
        }
    }, [id]);

    useEffect(() => {
        if (!id) { setError("Invalid campaign ID."); setLoading(false); return; }
        const controller = new AbortController();
        fetchCampaign(controller.signal);
        return () => controller.abort();
    }, [fetchCampaign, id]);

    useEffect(() => {
        if (!campaign || !POLLING_STATUSES.includes(campaign.status as typeof POLLING_STATUSES[number])) return;
        let cancelled = false;
        const poll = async () => {
            while (!cancelled) {
                await fetchCampaign();
                await new Promise<void>((resolve) => setTimeout(resolve, 5_000));
            }
        };
        void poll();
        return () => { cancelled = true; };
    }, [campaign?.status, fetchCampaign]);

    async function handlePause() {
        if (!campaign || isPausing || isActioning) return;
        setActionError(null); setIsPausing(true);
        try {
            const res = await apiRequest(`/api/campaigns/${campaign.id}/pause`, { method: "POST" });
            if (!res.ok) { const b = await res.json().catch(() => null); throw new Error(b?.error ?? `Request failed (${res.status})`); }
            await fetchCampaign();
        } catch (err) {
            if (mounted.current) setActionError(err instanceof Error ? err.message : "Failed to pause campaign.");
        } finally {
            if (mounted.current) setIsPausing(false);
        }
    }

    async function handleRun() {
        if (!campaign || isActioning || isPausing) return;
        setActionError(null); setIsActioning(true);
        try {
            const res = await apiRequest(`/api/campaigns/${campaign.id}/run`, { method: "POST" });
            if (!res.ok) { const b = await res.json().catch(() => null); throw new Error(b?.error ?? `Request failed (${res.status})`); }
            await fetchCampaign();
        } catch (err) {
            if (mounted.current) setActionError(err instanceof Error ? err.message : "Failed to start campaign.");
        } finally {
            if (mounted.current) setIsActioning(false);
        }
    }

    async function handleResume() {
        if (!campaign || isActioning || isPausing) return;
        setActionError(null); setIsActioning(true);
        try {
            const res = await apiRequest(`/api/campaigns/${campaign.id}/resume`, { method: "POST" });
            if (!res.ok) { const b = await res.json().catch(() => null); throw new Error(b?.error ?? `Request failed (${res.status})`); }
            await fetchCampaign();
        } catch (err) {
            if (mounted.current) setActionError(err instanceof Error ? err.message : "Failed to resume campaign.");
        } finally {
            if (mounted.current) setIsActioning(false);
        }
    }

    const leadsCount = useMemo(
        () => campaign?._count?.leads ?? campaign?.leads?.length ?? 0,
        [campaign],
    );

    const stats = useMemo(() => [
        { label: "Leads", value: leadsCount.toLocaleString(), color: "" },
        { label: "Sent", value: "—", color: "" },
        { label: "Open Rate", value: "—", color: "text-sky-400" },
        { label: "Reply Rate", value: "—", color: "text-emerald-400" },
    ], [leadsCount]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="flex flex-col items-center gap-3">
                    <svg className="animate-spin text-[var(--red)]" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    <p className="text-sm text-[var(--text-muted)]">Loading campaign…</p>
                </div>
            </div>
        );
    }

    if (error || !campaign) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-center space-y-3">
                    <p className="text-sm font-medium text-[var(--text-secondary)]">{error ?? "Campaign not found."}</p>
                    <Link href="/dashboard/campaigns" className="text-xs text-[var(--red)] hover:underline">← Back to Campaigns</Link>
                </div>
            </div>
        );
    }

    const canPause = PAUSABLE_STATUSES.includes(campaign.status as typeof PAUSABLE_STATUSES[number]);
    const canRun = campaign.status === "DRAFT" || campaign.status === "FAILED";
    const canResume = campaign.status === "PAUSED";

    const metaChips = [
        { icon: "🏭", label: campaign.targetIndustry },
        { icon: "📍", label: campaign.targetRegion },
        { icon: "📨", label: campaign.dailySendLimit ? `${campaign.dailySendLimit}/day` : null },
        { icon: "🌐", label: campaign.senderDomain },
    ].filter((c) => c.label);

    return (
        <div className="flex flex-col h-full overflow-hidden">

            {/* ── Single compact header row: replaces TopBar + old campaign header top ── */}
            <header className="flex-shrink-0 bg-[var(--navy-mid)] border-b border-[var(--border)]">

                {/* Title bar — always visible, 48px */}
                <div className="flex items-center gap-2 px-5 h-12 border-b border-[var(--border)]">
                    <Link
                        href="/dashboard/campaigns"
                        className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors flex-shrink-0 focus-visible:outline-none focus-visible:underline"
                    >
                        Campaigns
                    </Link>
                    <span className="text-[var(--text-muted)] text-xs flex-shrink-0" aria-hidden="true">›</span>
                    <CampaignBadge status={campaign.status} />
                    <h1 className="text-sm font-semibold text-[var(--text-primary)] truncate flex-1 min-w-0">
                        {campaign.name}
                    </h1>

                    {/* Meta chips — hidden below lg to avoid overflow */}
                    {metaChips.length > 0 && (
                        <div className="hidden lg:flex items-center gap-1.5 flex-shrink-0">
                            {metaChips.map((chip) => (
                                <span
                                    key={chip.label}
                                    className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)] bg-[var(--surface-2)] border border-[var(--border)] px-2 py-0.5 rounded-full whitespace-nowrap"
                                >
                                    <span aria-hidden="true">{chip.icon}</span>
                                    {chip.label}
                                </span>
                            ))}
                        </div>
                    )}

                    {actionError && (
                        <p className="text-xs text-red-400 flex-shrink-0 max-w-[200px] truncate">{actionError}</p>
                    )}

                    {/* Action buttons */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                        <Link
                            href={`/dashboard/campaigns/${id}/edit`}
                            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                        >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                            Edit
                        </Link>

                        {canPause && (
                            <button
                                onClick={handlePause}
                                disabled={isPausing || isActioning}
                                className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-amber-400/30 text-amber-400 hover:bg-amber-400/10 transition-all duration-150 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                            >
                                {isPausing
                                    ? <svg className="animate-spin" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                                    : <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
                                }
                                {isPausing ? "Pausing…" : "Pause"}
                            </button>
                        )}

                        {canRun && (
                            <button
                                onClick={handleRun}
                                disabled={isActioning || isPausing}
                                className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-[var(--red)] text-white hover:bg-[var(--red-dim)] active:scale-[0.97] transition-all duration-150 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                            >
                                {isActioning
                                    ? <svg className="animate-spin" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                                    : <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                                }
                                {isActioning ? "Starting…" : "Run Pipeline"}
                            </button>
                        )}

                        {canResume && (
                            <button
                                onClick={handleResume}
                                disabled={isActioning || isPausing}
                                className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-[var(--red)] text-white hover:bg-[var(--red-dim)] active:scale-[0.97] transition-all duration-150 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                            >
                                {isActioning
                                    ? <svg className="animate-spin" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                                    : <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                                }
                                {isActioning ? "Resuming…" : "Resume"}
                            </button>
                        )}
                    </div>
                </div>

                {/* Stats bar — pipeline tab only */}
                {activeTab === "pipeline" && (
                    <div className="grid grid-cols-4 divide-x divide-[var(--border)] border-b border-[var(--border)]">
                        {stats.map((stat) => (
                            <div key={stat.label} className="flex flex-col items-center py-2.5 px-4 hover:bg-[var(--surface-2)] transition-colors duration-150">
                                <span className={`text-base font-bold font-display tabular-nums leading-none ${stat.color || "text-[var(--text-primary)]"}`}>
                                    {stat.value}
                                </span>
                                <span className="text-xs text-[var(--text-muted)] mt-1 uppercase tracking-wider font-medium">
                                    {stat.label}
                                </span>
                            </div>
                        ))}
                    </div>
                )}

                {/* Tab bar — always visible, tighter than before */}
                <nav className="flex gap-0.5 px-5 -mb-px overflow-x-auto" role="tablist" aria-label="Campaign sections">
                    {TABS.map((tab) => (
                        <button
                            key={tab.id}
                            id={`tab-${tab.id}`}
                            role="tab"
                            aria-selected={activeTab === tab.id}
                            aria-controls={`panel-${tab.id}`}
                            onClick={() => setActiveTab(tab.id)}
                            className={[
                                "inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all duration-150 whitespace-nowrap flex-shrink-0",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] focus-visible:ring-inset",
                                activeTab === tab.id
                                    ? "border-[var(--red)] text-[var(--red)]"
                                    : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border)]",
                            ].join(" ")}
                        >
                            <span aria-hidden="true">{tab.icon}</span>
                            {tab.label}
                        </button>
                    ))}
                </nav>
            </header>

            {/* ── Tab panels ── */}
            <div className="flex-1 overflow-hidden">
                <div role="tabpanel" id="panel-pipeline" aria-labelledby="tab-pipeline" hidden={activeTab !== "pipeline"} className="h-full overflow-y-auto">
                    {activeTab === "pipeline" && (
                        <>
                            {campaign.description && (
                                <p className="px-6 pt-5 pb-0 text-sm text-[var(--text-secondary)] leading-relaxed max-w-3xl">
                                    {campaign.description}
                                </p>
                            )}
                            <div className="px-6 pt-4">
                                <Suspense fallback={
                                    <div className="py-8 flex items-center justify-center">
                                        <svg className="animate-spin text-[var(--red)]" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                                        </svg>
                                    </div>
                                }>
                                    <CampaignNarrativeLazy campaignId={campaign.id} />
                                </Suspense>
                            </div>
                            <PipelineTab campaignId={campaign.id} status={campaign.status} />
                        </>
                    )}
                </div>

                <div role="tabpanel" id="panel-leads" aria-labelledby="tab-leads" hidden={activeTab !== "leads"} className="h-full overflow-hidden">
                    {activeTab === "leads" && <LeadsTab campaignId={campaign.id} />}
                </div>

                <div role="tabpanel" id="panel-prospects" aria-labelledby="tab-prospects" hidden={activeTab !== "prospects"} className="h-full overflow-hidden">
                    {activeTab === "prospects" && <ICPSearch campaignId={campaign.id} />}
                </div>

                <div role="tabpanel" id="panel-messages" aria-labelledby="tab-messages" hidden={activeTab !== "messages"} className="h-full overflow-hidden">
                    {activeTab === "messages" && <MessagesTab campaignId={campaign.id} />}
                </div>

                <div role="tabpanel" id="panel-deliverability" aria-labelledby="tab-deliverability" hidden={activeTab !== "deliverability"} className="h-full overflow-y-auto">
                    {activeTab === "deliverability" && <DeliverabilityTab campaignId={campaign.id} />}
                </div>

                <div role="tabpanel" id="panel-discovery" aria-labelledby="tab-discovery" hidden={activeTab !== "discovery"} className="h-full overflow-y-auto">
                    {activeTab === "discovery" && (
                        <div className="px-6 py-6">
                            <DiscoveryRunsPanel campaignId={campaign.id} />
                        </div>
                    )}
                </div>

                <div role="tabpanel" id="panel-signals" aria-labelledby="tab-signals" hidden={activeTab !== "signals"} className="h-full overflow-hidden">
                    {activeTab === "signals" && <SignalsTab campaignId={campaign.id} />}
                </div>

                <div role="tabpanel" id="panel-sequence" aria-labelledby="tab-sequence" hidden={activeTab !== "sequence"} className="h-full overflow-y-auto">
                    {activeTab === "sequence" && <SequenceTab campaignId={campaign.id} />}
                </div>
            </div>
        </div>
    );
}