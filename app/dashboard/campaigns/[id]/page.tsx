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
import type { CampaignStatus } from "@/app/components/dashboard/badges";
import { TopBar } from "@/app/components/dashboard/TopBar";

interface CampaignSSEEvent {
    campaignId: string;
    type: "active" | "progress" | "completed" | "failed";
    jobName: string;
    label: string;
    progress?: number;
    detail?: string;
    count?: number;
    timestamp: string;
}

const LIVE_EVENT_CAP = 8;

const CampaignNarrativeLazy = lazy(() =>
    import("@/app/components/dashboard/CampaignNarrative").then((m) => ({
        default: m.CampaignNarrative,
    }))
);

export type Tab = "pipeline" | "leads" | "messages" | "deliverability" | "discovery" | "signals" | "sequence";

const PAUSABLE_STATUSES = [
    "SENDING",
    "QUEUED",
    "GENERATING",
    "RESEARCHING",
    "REVIEW",
] as const satisfies readonly CampaignStatus[];

const POLLING_STATUSES = [
    "QUEUED",
    "RESEARCHING",
    "GENERATING",
    "REVIEW",
    "SENDING",
] as const satisfies readonly CampaignStatus[];

const PIPELINE_STAGES = [
    { label: "Queued", status: "QUEUED" },
    { label: "Researching", status: "RESEARCHING" },
    { label: "Generating", status: "GENERATING" },
    { label: "Review", status: "REVIEW" },
    { label: "Sending", status: "SENDING" },
] as const satisfies readonly { label: string; status: typeof POLLING_STATUSES[number] }[];

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
    senderMailboxId: string | null;
    linkedInAccountId: string | null;
    pauseReason: string | null;
    lastFailureMessage: string | null;
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
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
        ),
    },
    {
        id: "leads",
        label: "Leads",
        icon: (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
        ),
    },
    {
        id: "messages",
        label: "Messages",
        icon: (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
            </svg>
        ),
    },
    {
        id: "deliverability",
        label: "Deliverability",
        icon: (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
        ),
    },
    {
        id: "discovery",
        label: "Discovery",
        icon: (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
        ),
    },
    {
        id: "signals",
        label: "Signals",
        icon: (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
        ),
    },
    {
        id: "sequence",
        label: "Sequence",
        icon: (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
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

const PAUSE_REASON_LABELS: Record<string, string> = {
    BOUNCE_RATE_EXCEEDED: "Bounce rate exceeded 5% threshold",
    COMPLAINT_RATE_EXCEEDED: "Spam complaint rate exceeded limit",
    DOMAIN_BLOCKED: "Sending domain flagged as blocked",
    MANUAL_PAUSE: "Manually paused by operator",
    HEALTH_CHECK_FAILED: "Domain health check failed",
};

const FAILURE_RECOVERY_STEPS: Record<string, { label: string; action: string }> = {
    DNS_RECORD_MISSING: { label: "DNS records are missing or invalid", action: "Fix SPF, DKIM, and DMARC in your domain settings, then re-verify before relaunching." },
    CREDENTIALS_EXPIRED: { label: "Mailbox credentials expired", action: "Re-authenticate your sending mailbox in Settings → Mailboxes, then relaunch." },
    LINKEDIN_AUTH_FAILED: { label: "LinkedIn session expired", action: "Re-connect your LinkedIn account in Settings → LinkedIn, then relaunch." },
    API_LIMIT_REACHED: { label: "API rate limit hit", action: "The AI agent hit a rate limit. Wait a few minutes, then relaunch — it will retry automatically." },
    NO_SENDER_CONFIGURED: { label: "No sender configured", action: "Assign a Sender Domain and Sender Mailbox in campaign settings, then relaunch." },
    COMPLIANCE_BLOCKED: { label: "Email copy blocked by compliance rules", action: "Review your ICP description and messaging guidelines, then relaunch to regenerate copy." },
    UNKNOWN_ERROR: { label: "Unexpected pipeline error", action: "Check AI Traces for details. If the issue persists, contact support." },
};

function formatRelativeTime(iso: string): string {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return "";
    const diffMs = Date.now() - then;
    const diffSec = Math.max(0, Math.floor(diffMs / 1000));
    if (diffSec < 60) return "just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 30) return `${diffDay}d ago`;
    return new Date(iso).toLocaleDateString();
}

function FailedCampaignBanner({ message, onEdit }: { message: string | null; onEdit: () => void }) {
    const [dismissed, setDismissed] = useState(false);
    if (dismissed) return null;

    const codeMatch = message?.match(/^\[([A-Z_]+)\]/);
    const isQuotaError = !codeMatch && !!message && (message.includes("429") || message.includes("quota") || message.includes("Too Many Requests") || message.includes("RESOURCE_EXHAUSTED"));
    const code = codeMatch?.[1] ?? (isQuotaError ? "API_LIMIT_REACHED" : "UNKNOWN_ERROR");
    const recovery = FAILURE_RECOVERY_STEPS[code] ?? FAILURE_RECOVERY_STEPS["UNKNOWN_ERROR"];

    return (
        <div className="flex-shrink-0 flex items-center gap-3 px-5 py-2 bg-[var(--red-glow)] border-b border-[var(--border-red)]" role="alert" aria-live="polite">
            <div className="w-4 h-4 rounded-full bg-[var(--red)]/10 border border-[var(--red)]/30 flex items-center justify-center flex-shrink-0">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[var(--red)]" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
            </div>
            <div className="flex-1 min-w-0 flex items-baseline gap-2">
                <p className="text-xs font-semibold text-[var(--red)] whitespace-nowrap">
                    Campaign failed: {recovery.label}
                </p>
                <p className="text-[10px] text-[var(--text-muted)] truncate">
                    {recovery.action}
                </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
                <button
                    onClick={onEdit}
                    className="text-[10px] font-medium px-2.5 py-1 rounded-lg border border-[var(--border-red)] text-[var(--red)] hover:bg-[var(--red)]/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                >
                    Open Settings
                </button>
                <button
                    onClick={() => setDismissed(true)}
                    aria-label="Dismiss banner"
                    className="w-5 h-5 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none"
                >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
            </div>
        </div>
    );
}

function PauseHealthBanner({
    reason,
    onGoToDeliverability,
    onAcknowledgeAndResume,
    resuming,
}: {
    reason: string | null;
    onGoToDeliverability: () => void;
    onAcknowledgeAndResume: () => void;
    resuming: boolean;
}) {
    const [dismissed, setDismissed] = useState(false);
    if (dismissed) return null;

    const label = reason
        ? (PAUSE_REASON_LABELS[reason] ?? reason.replace(/_/g, " ").toLowerCase())
        : null;

    return (
        <div className="flex-shrink-0 flex items-center gap-3 px-5 py-2 bg-amber-400/5 border-b border-amber-400/20" role="alert" aria-live="polite">
            <div className="w-4 h-4 rounded-full bg-amber-400/10 border border-amber-400/30 flex items-center justify-center flex-shrink-0">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-amber-400" aria-hidden="true">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
            </div>
            <div className="flex-1 min-w-0 flex items-baseline gap-2">
                <p className="text-xs font-semibold text-amber-400 whitespace-nowrap">
                    Campaign auto-paused{label ? `: ${label}` : ""}
                </p>
                <p className="text-[10px] text-[var(--text-muted)] truncate">
                    Review your deliverability data before resuming to avoid continued issues.
                </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
                <button
                    onClick={onGoToDeliverability}
                    className="text-[10px] font-medium px-2.5 py-1 rounded-lg border border-amber-400/30 text-amber-400 hover:bg-amber-400/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                >
                    Review Deliverability
                </button>
                <button
                    onClick={() => { onAcknowledgeAndResume(); setDismissed(true); }}
                    disabled={resuming}
                    className="text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-amber-400/10 border border-amber-400/30 text-amber-400 hover:bg-amber-400/20 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                >
                    {resuming ? "Resuming…" : "Acknowledge & Resume"}
                </button>
                <button
                    onClick={() => setDismissed(true)}
                    aria-label="Dismiss banner"
                    className="w-5 h-5 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none"
                >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
            </div>
        </div>
    );
}

async function apiRequest(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}

function CampaignDetailPageInner() {
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
        const params = new URLSearchParams(searchParams.toString());
        params.set("tab", tab);
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }

    const [isPausing, setIsPausing] = useState(false);
    const [isActioning, setIsActioning] = useState(false);
    const [isDiscovering, setIsDiscovering] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [narrativeOpen, setNarrativeOpen] = useState(false);
    const [liveEvents, setLiveEvents] = useState<CampaignSSEEvent[]>([]);
    const [liveLeadCount, setLiveLeadCount] = useState<number | null>(null);
    const [statsRevision, setStatsRevision] = useState(0);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!menuOpen) return;
        function handleClick(e: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, [menuOpen]);

    useEffect(() => {
        const stored = window.localStorage.getItem("campaign-narrative-visible");
        if (stored === "true") setNarrativeOpen(true);
    }, []);

    function toggleNarrative() {
        setNarrativeOpen((prev) => {
            const next = !prev;
            window.localStorage.setItem("campaign-narrative-visible", String(next));
            return next;
        });
    }

    const mounted = useRef(true);
    useEffect(() => {
        return () => {
            mounted.current = false;
        };
    }, []);

    const fetchCampaign = useCallback(async (signal?: AbortSignal) => {
        if (mounted.current) setLoading(true);
        try {
            const [res, statsRes] = await Promise.all([
                fetch(`/api/campaigns/${id}`, { cache: "no-store", signal }),
                fetch(`/api/campaigns/${id}/pipeline-stats`, { cache: "no-store", signal }).catch(() => null),
            ]);
            if (res.status === 404) {
                if (mounted.current) {
                    setError("Campaign not found.");
                    setLoading(false);
                }
                return;
            }
            if (!res.ok) throw new Error(`Server error ${res.status}`);
            const raw = await res.json() as Campaign & { queueJobs?: { errorMessage: string | null }[] };
            const stats = statsRes?.ok ? await statsRes.json().catch(() => null) : null;
            const data: Campaign = {
                ...raw,
                lastFailureMessage: raw.queueJobs?.[0]?.errorMessage ?? null,
                _count: {
                    leads: typeof stats?.leadsTotal === "number" ? stats.leadsTotal : (raw._count?.leads ?? 0),
                },
            };
            if (mounted.current) {
                setError(null);
                setCampaign(data);
            }
        } catch (err) {
            if (err instanceof DOMException && err.name === "AbortError") return;
            if (mounted.current) {
                setError(err instanceof Error ? err.message : "Failed to load campaign.");
            }
        } finally {
            if (mounted.current) setLoading(false);
        }
    }, [id]);

    useEffect(() => {
        if (!id) {
            setError("Invalid campaign ID.");
            setLoading(false);
            return;
        }
        const controller = new AbortController();
        fetchCampaign(controller.signal);
        return () => controller.abort();
    }, [fetchCampaign, id]);

    useEffect(() => {
        if (!campaign || !POLLING_STATUSES.includes(campaign.status as typeof POLLING_STATUSES[number])) {
            return;
        }
        let cancelled = false;
        const poll = async () => {
            let interval = 5_000;
            while (!cancelled) {
                await fetchCampaign();
                await new Promise<void>((resolve) => setTimeout(resolve, interval));
                interval = Math.min(Math.floor(interval * 1.4), 30_000);
            }
        };
        void poll();
        return () => {
            cancelled = true;
        };
    }, [campaign?.status, fetchCampaign]);

    useEffect(() => {
        const isActive = campaign && POLLING_STATUSES.includes(campaign.status as typeof POLLING_STATUSES[number]);
        if (!isActive || !id) return;

        setLiveEvents([]);
        setLiveLeadCount(null);

        const es = new EventSource("/api/campaigns/events");

        es.onmessage = (e) => {
            try {
                const event: CampaignSSEEvent = JSON.parse(e.data);
                if (event.campaignId !== id) return;
                if (event.type === "progress" || event.type === "active") {
                    setLiveEvents((prev) => [event, ...prev].slice(0, LIVE_EVENT_CAP));
                    if (typeof event.count === "number" && event.count > 0) {
                        setLiveLeadCount(event.count);
                    }
                } else if (event.type === "completed" || event.type === "failed") {
                    setLiveLeadCount(null);
                    setLiveEvents([]);
                }
            } catch {}
        };

        es.onerror = () => es.close();

        return () => es.close();
    }, [campaign?.status, id]);

    async function handlePause() {
        if (!campaign || isPausing || isActioning) return;
        setActionError(null);
        setIsPausing(true);
        try {
            const res = await apiRequest(`/api/campaigns/${campaign.id}/pause`, { method: "POST" });
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new Error(body?.error ?? `Request failed (${res.status})`);
            }
            await fetchCampaign();
        } catch (err) {
            if (mounted.current) {
                setActionError(err instanceof Error ? err.message : "Failed to pause campaign.");
            }
        } finally {
            if (mounted.current) setIsPausing(false);
        }
    }

    async function handleRun() {
        if (!campaign || isActioning || isPausing) return;
        setActionError(null);
        setIsActioning(true);
        try {
            const res = await apiRequest(`/api/campaigns/${campaign.id}/run`, { method: "POST" });
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new Error(body?.error ?? `Request failed (${res.status})`);
            }
            await fetchCampaign();
        } catch (err) {
            if (mounted.current) {
                setActionError(err instanceof Error ? err.message : "Failed to start campaign.");
            }
        } finally {
            if (mounted.current) setIsActioning(false);
        }
    }

    async function handleResume() {
        if (!campaign || isActioning || isPausing) return;
        setActionError(null);
        setIsActioning(true);
        try {
            const res = await apiRequest(`/api/campaigns/${campaign.id}/resume`, { method: "POST" });
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new Error(body?.error ?? `Request failed (${res.status})`);
            }
            await fetchCampaign();
        } catch (err) {
            if (mounted.current) {
                setActionError(err instanceof Error ? err.message : "Failed to resume campaign.");
            }
        } finally {
            if (mounted.current) setIsActioning(false);
        }
    }

    async function handleDiscover() {
        if (!campaign || isDiscovering || isActioning || isPausing) return;
        setActionError(null);
        setIsDiscovering(true);
        try {
            const res = await apiRequest(`/api/campaigns/${campaign.id}/discover`, { method: "POST" });
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new Error(body?.error ?? `Request failed (${res.status})`);
            }
            await fetchCampaign();
        } catch (err) {
            if (mounted.current) {
                setActionError(err instanceof Error ? err.message : "Failed to start discovery.");
            }
        } finally {
            if (mounted.current) setIsDiscovering(false);
        }
    }

    const leadsCount = useMemo(
        () => {
            if (liveLeadCount !== null) return Math.max(liveLeadCount, campaign?._count?.leads ?? 0);
            return campaign?._count?.leads ?? campaign?.leads?.length ?? 0;
        },
        [campaign, liveLeadCount],
    );

    const facts = useMemo(() => {
        if (!campaign) return [];
        const items: { label: string; value: string; emphasis?: boolean }[] = [
            { label: "Leads", value: leadsCount.toLocaleString(), emphasis: true },
        ];
        const target = [campaign.targetIndustry, campaign.targetRegion].filter(Boolean).join(" · ");
        if (target) items.push({ label: "Target", value: target });
        const domainValue = typeof campaign.senderDomain === "string"
            ? campaign.senderDomain
            : (campaign.senderDomain as { domain?: string } | null)?.domain ?? null;
        if (domainValue) items.push({ label: "Domain", value: domainValue });
        if (campaign.dailySendLimit) items.push({ label: "Daily Limit", value: `${campaign.dailySendLimit}/day` });
        items.push({ label: "Created", value: formatRelativeTime(campaign.createdAt) });
        return items;
    }, [campaign, leadsCount]);

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
                    <Link href="/dashboard/campaigns" className="text-xs text-[var(--red)] hover:underline">
                        ← Back to Campaigns
                    </Link>
                </div>
            </div>
        );
    }

    const canPause = PAUSABLE_STATUSES.includes(campaign.status as typeof PAUSABLE_STATUSES[number]);
    const canRun = campaign.status === "DRAFT" || campaign.status === "FAILED";
    const canResume = campaign.status === "PAUSED" && !campaign.pauseReason;
    const canDiscover = canRun && leadsCount === 0;
    const currentStageIndex = PIPELINE_STAGES.findIndex((s) => s.status === campaign.status);
    const showStepper = currentStageIndex !== -1;
    const isBusy = isActioning || isPausing || isDiscovering;

    type PrimaryAction = {
        label: string;
        onClick: () => void;
        pending: boolean;
        tone: "brand" | "amber";
        icon: React.ReactNode;
    };

    let primaryAction: PrimaryAction | null = null;
    if (canPause) {
        primaryAction = {
            label: isPausing ? "Pausing…" : "Pause Campaign",
            onClick: handlePause,
            pending: isPausing,
            tone: "amber",
            icon: (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
            ),
        };
    } else if (canResume) {
        primaryAction = {
            label: isActioning ? "Resuming…" : "Resume Campaign",
            onClick: handleResume,
            pending: isActioning,
            tone: "brand",
            icon: (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3" /></svg>
            ),
        };
    } else if (canRun) {
        const isRetry = campaign.status === "FAILED";
        primaryAction = {
            label: isActioning ? (isRetry ? "Retrying…" : "Starting…") : (isRetry ? "Retry Pipeline" : "Run Campaign"),
            onClick: handleRun,
            pending: isActioning,
            tone: "brand",
            icon: (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3" /></svg>
            ),
        };
    }

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <TopBar
                title={campaign.name}
                breadcrumbs={[{ label: "Campaigns", href: "/dashboard/campaigns" }]}
                actions={
                    <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                            id="btn-discover-leads"
                            onClick={handleDiscover}
                            disabled={!canDiscover || isBusy}
                            title={canDiscover ? undefined : "Available before your first discovery run"}
                            aria-label="Discover leads"
                            className={[
                                "inline-flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400",
                                canDiscover ? "text-sky-400 hover:bg-sky-400/10" : "text-[var(--text-muted)] opacity-40 cursor-not-allowed",
                            ].join(" ")}
                        >
                            {isDiscovering ? (
                                <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                            ) : (
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <circle cx="11" cy="11" r="8" />
                                    <path d="m21 21-4.35-4.35" />
                                </svg>
                            )}
                            {isDiscovering ? "Discovering…" : "Discover Leads"}
                        </button>

                        {primaryAction && (
                            <button
                                onClick={primaryAction.onClick}
                                disabled={isBusy}
                                aria-label={primaryAction.label}
                                className={[
                                    "inline-flex items-center gap-2 text-xs font-semibold px-3.5 py-2 rounded-lg text-white shadow-sm active:scale-[0.97] transition-all duration-150 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--navy-mid)]",
                                    primaryAction.tone === "brand"
                                        ? "bg-[var(--red)] hover:bg-[var(--red-dim)] focus-visible:ring-[var(--red)]"
                                        : "bg-amber-500 hover:bg-amber-600 focus-visible:ring-amber-500",
                                ].join(" ")}
                            >
                                {primaryAction.pending ? (
                                    <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                                ) : primaryAction.icon}
                                {primaryAction.label}
                            </button>
                        )}

                        <div className="relative" ref={menuRef}>
                            <button
                                onClick={() => setMenuOpen((v) => !v)}
                                aria-label="More actions"
                                aria-expanded={menuOpen}
                                className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
                                    <circle cx="12" cy="5" r="1.6" />
                                    <circle cx="12" cy="12" r="1.6" />
                                    <circle cx="12" cy="19" r="1.6" />
                                </svg>
                            </button>
                            {menuOpen && (
                                <div className="absolute right-0 mt-1 w-40 rounded-lg bg-[var(--navy-mid)] border border-[var(--border)] shadow-lg py-1 z-20">
                                    <Link
                                        href={`/dashboard/campaigns/${id}/edit`}
                                        className="flex items-center gap-2 px-3 py-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors"
                                        onClick={() => setMenuOpen(false)}
                                    >
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                        </svg>
                                        Edit Campaign
                                    </Link>
                                </div>
                            )}
                        </div>
                    </div>
                }
            />

            {campaign.status === "PAUSED" && campaign.pauseReason && (
                <PauseHealthBanner
                    reason={campaign.pauseReason}
                    onGoToDeliverability={() => setActiveTab("deliverability")}
                    onAcknowledgeAndResume={handleResume}
                    resuming={isActioning}
                />
            )}
            {campaign.status === "FAILED" && (
                <FailedCampaignBanner
                    message={campaign.lastFailureMessage}
                    onEdit={() => router.push(`/dashboard/campaigns/${id}/edit`)}
                />
            )}

            <header className="flex-shrink-0 border-b border-[var(--border)] bg-[var(--navy-mid)]">
                <div className="flex items-center justify-between gap-4 px-6 py-2">
                    <div className="flex items-center gap-3 flex-wrap text-[11px] text-[var(--text-muted)]">
                        <CampaignBadge status={campaign.status} />
                        
                        <span>&middot;</span>
                        <span className="text-[var(--text-primary)] font-bold tabular-nums">{leadsCount} Leads</span>
                        
                        {campaign.targetIndustry && (
                            <>
                                <span>&middot;</span>
                                <span className="truncate max-w-[200px]" title={campaign.targetIndustry}>{campaign.targetIndustry}</span>
                            </>
                        )}
                        
                        {campaign.dailySendLimit && (
                            <>
                                <span>&middot;</span>
                                <span>{campaign.dailySendLimit}/day limit</span>
                            </>
                        )}
                        
                        <span>&middot;</span>
                        <span>Created {formatRelativeTime(campaign.createdAt)}</span>
                        
                        <span className="text-[var(--text-muted)] opacity-50">
                            (Updated {formatRelativeTime(campaign.updatedAt)})
                        </span>
                    </div>

                    <div className="flex items-center gap-6 flex-shrink-0">
                        {showStepper && (
                            <div className="flex items-center gap-2" title={`Stage: ${PIPELINE_STAGES[currentStageIndex].label}`}>
                                <span className="text-[10px] text-[var(--text-secondary)] font-semibold uppercase tracking-wider">
                                    Pipeline
                                </span>
                                <div className="flex items-center gap-0.5 w-16">
                                    {PIPELINE_STAGES.map((stage, i) => (
                                        <div
                                            key={stage.status}
                                            className={`h-1 flex-1 rounded-full ${
                                                i < currentStageIndex
                                                    ? "bg-emerald-400"
                                                    : i === currentStageIndex
                                                    ? "bg-[var(--red)] animate-pulse"
                                                    : "bg-[var(--surface-2)]"
                                            }`}
                                        />
                                    ))}
                                </div>
                                <span className="text-[10px] font-bold text-[var(--text-primary)]">
                                    {PIPELINE_STAGES[currentStageIndex].label}
                                </span>
                            </div>
                        )}

                        <button
                            onClick={toggleNarrative}
                            aria-expanded={narrativeOpen}
                            className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)] transition-colors"
                        >
                            <svg
                                width="8"
                                height="8"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="3"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className={`transition-transform duration-150 ${narrativeOpen ? "rotate-90" : ""}`}
                                aria-hidden="true"
                            >
                                <polyline points="9 18 15 12 9 6" />
                            </svg>
                            AI Summary
                        </button>
                    </div>
                </div>

                {campaign.description && (
                    <div className="px-6 pb-2 -mt-1">
                        <p className="text-[11px] text-[var(--text-muted)] truncate max-w-4xl leading-none">
                            {campaign.description}
                        </p>
                    </div>
                )}

                {narrativeOpen && (
                    <div className="px-6 pb-3 border-t border-[var(--border)] pt-2 bg-[var(--navy-deep)]/35">
                        <Suspense fallback={
                            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] py-1">
                                <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                                Loading AI summary…
                            </div>
                        }>
                            <CampaignNarrativeLazy campaignId={campaign.id} />
                        </Suspense>
                    </div>
                )}
            </header>

            <nav className="flex gap-1 px-6 -mb-px" role="tablist" aria-label="Campaign sections">
                {TABS.map((tab) => (
                    <button
                        key={tab.id}
                        id={`tab-${tab.id}`}
                        role="tab"
                        aria-selected={activeTab === tab.id}
                        aria-controls={`panel-${tab.id}`}
                        onClick={() => setActiveTab(tab.id)}
                        className={[
                            "inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all duration-150",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] focus-visible:ring-inset",
                            activeTab === tab.id
                                ? "border-[var(--red)] text-[var(--red)]"
                                : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border)]",
                        ].join(" ")}
                    >
                        <span aria-hidden="true">{tab.icon}</span>
                        {tab.label}
                        {tab.id === "leads" && leadsCount > 0 && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${activeTab === tab.id ? "bg-[var(--red)]/15 text-[var(--red)]" : "bg-[var(--surface-2)] text-[var(--text-muted)]"}`}>
                                {leadsCount.toLocaleString()}
                            </span>
                        )}
                    </button>
                ))}
            </nav>

            <div className="flex-1 overflow-hidden">
                <div role="tabpanel" id="panel-pipeline" aria-labelledby="tab-pipeline" hidden={activeTab !== "pipeline"} className="h-full overflow-y-auto">
                    {activeTab === "pipeline" && (
                        <PipelineTab key={statsRevision} campaignId={campaign.id} status={campaign.status} liveEvents={liveEvents} />
                    )}
                </div>
                <div role="tabpanel" id="panel-leads" aria-labelledby="tab-leads" hidden={activeTab !== "leads"} className="h-full overflow-hidden">
                    {activeTab === "leads" && <LeadsTab campaignId={campaign.id} campaign={campaign} />}
                </div>
                <div role="tabpanel" id="panel-messages" aria-labelledby="tab-messages" hidden={activeTab !== "messages"} className="h-full overflow-hidden">
                    {activeTab === "messages" && <MessagesTab campaignId={campaign.id} onSendComplete={() => setStatsRevision((r) => r + 1)} />}
                </div>
                <div role="tabpanel" id="panel-deliverability" aria-labelledby="tab-deliverability" hidden={activeTab !== "deliverability"} className="h-full overflow-y-auto">
                    {activeTab === "deliverability" && <DeliverabilityTab key={statsRevision} campaignId={campaign.id} />}
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

export default function CampaignDetailPage() {
    return (
        <Suspense fallback={
            <div className="flex items-center justify-center h-full">
                <div className="flex flex-col items-center gap-3">
                    <svg className="animate-spin text-[var(--red)]" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    <p className="text-sm text-[var(--text-muted)]">Loading campaign…</p>
                </div>
            </div>
        }>
            <CampaignDetailPageInner />
        </Suspense>
    );
}