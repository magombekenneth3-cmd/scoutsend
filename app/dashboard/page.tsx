"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { TopBar } from "../components/dashboard/TopBar";
import { StatCard } from "../components/dashboard/StatsCard";
import { ActivityFeed } from "../components/dashboard/ActivityFeed";
import { CampaignTable } from "../components/dashboard/CampaignTable";
import { DomainCard } from "../components/dashboard/Domain.card";
import { LiveStatusBadges } from "../components/dashboard/LiveStatusBadges";
import { DashboardChart } from "../components/dashboard/DashboardChart";
import { useCampaignEvents } from "../hooks/useCampaignEvents";
import type { Campaign } from "../components/dashboard/CampaignTable";
import type { ActivityType } from "../components/dashboard/ActivityFeed";
import type { DomainHealth } from "../components/dashboard/badges";

interface DashboardStats {
    activeCampaigns: number;
    emailsSentToday: number;
    openRate: number;
    replyRate: number;
    positiveIntentRate: number;
    openRateDelta: number | null;
    replyRateDelta: number | null;
    positiveIntentRateDelta: number | null;
    campaigns: Campaign[];
    domains: {
        id: string;
        domain: string;
        health: DomainHealth;
        reputationScore: number;
        currentSent: number;
        dailyLimit: number;
        bounceRate: number;
        warmupEnabled?: boolean;
        warmupLimit?: number;
    }[];
    activityEvents: {
        id: string;
        type: ActivityType;
        message: string;
        detail?: string;
        timestamp: string;
        timestampIso: string;
    }[];
    pendingApprovals: number;
}

function formatRelativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

function formatDelta(d: number | null): string | undefined {
    if (d === null) return undefined;
    if (d === 0) return undefined;
    return `${d > 0 ? "+" : ""}${d.toFixed(1)}%`;
}

function deltaToTrend(d: number | null): "up" | "down" | "neutral" | undefined {
    if (d === null || d === 0) return "neutral";
    return d > 0 ? "up" : "down";
}

const fetcher = async (url: string): Promise<DashboardStats> => {
    const res = await fetch(url);
    if (res.status === 401) throw Object.assign(new Error("Unauthorized"), { status: 401 });
    if (!res.ok) throw new Error(`API returned ${res.status}`);
    const stats: DashboardStats = await res.json();
    stats.activityEvents = stats.activityEvents.map((e) => ({
        ...e,
        timestamp: formatRelativeTime(e.timestampIso ?? e.timestamp),
    }));
    return stats;
};

function Skeleton({ className }: { className?: string }) {
    return (
        <div
            className={`skeleton-shimmer rounded-xl ${className ?? ""}`}
            aria-hidden="true"
        />
    );
}


function DashboardSkeleton() {
    return (
        <div
            className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6"
            aria-label="Loading dashboard"
            aria-busy="true"
        >
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <Skeleton className="xl:col-span-2 h-72" />
                <Skeleton className="h-72" />
            </div>
            <Skeleton className="h-64" />
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
            </div>
        </div>
    );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <div
            role="alert"
            className="m-4 sm:m-6 flex items-start gap-3 p-4 bg-[var(--red-glow)] border border-[var(--border-red)] rounded-xl"
        >
            <svg className="flex-shrink-0 mt-0.5 text-[var(--red)]" width="16" height="16" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div className="flex-1">
                <p className="text-sm font-medium text-[var(--red)]">{message}</p>
                <button
                    onClick={onRetry}
                    className="mt-2 text-xs text-[var(--text-secondary)] underline hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] rounded"
                >
                    Retry
                </button>
            </div>
        </div>
    );
}

const icons = {
    campaigns: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
            <rect x="9" y="3" width="6" height="4" rx="1" />
            <path d="M9 12h6M9 16h4" />
        </svg>
    ),
    send: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" />
        </svg>
    ),
    openRate: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,13 2,6" />
        </svg>
    ),
    reply: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="9 17 4 12 9 7" />
            <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
        </svg>
    ),
    positive: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
        </svg>
    ),
};

export default function DashboardPage() {
    const router = useRouter();

    const { data, error, isLoading, isValidating, mutate } = useSWR<DashboardStats>(
        "/api/dashboard/stats",
        fetcher,
        {
            revalidateOnFocus: true,
            revalidateOnReconnect: true,
            dedupingInterval: 10_000,
            keepPreviousData: true,
            onError: (err) => {
                if (err?.status === 401) router.replace("/auth/login");
            },
        },
    );

    const handleRefresh = useCallback(() => { mutate(); }, [mutate]);
    const { activeEvents, recentEvents } = useCampaignEvents({ onJobComplete: handleRefresh });

    const showSkeleton = isLoading && !data;
    const refreshing = isValidating && !!data;

    return (
        <div className="flex flex-col h-full">
            <TopBar
                title="Dashboard"
                subtitle="Overview of your outreach pipeline"
                actions={
                    <button
                        onClick={handleRefresh}
                        aria-label="Refresh dashboard"
                        title="Refresh"
                        className="flex items-center justify-center w-9 h-9 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        <svg
                            width="14" height="14" viewBox="0 0 24 24"
                            fill="none" stroke="currentColor" strokeWidth="2"
                            strokeLinecap="round" strokeLinejoin="round"
                            className={refreshing ? "animate-spin" : ""}
                            aria-hidden="true"
                        >
                            <path d="M21 2v6h-6" />
                            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                            <path d="M3 22v-6h6" />
                            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                        </svg>
                    </button>
                }
            />

            <div className="flex-1 overflow-y-auto">
                {showSkeleton && <DashboardSkeleton />}

                {!showSkeleton && error && !data && (
                    <ErrorBanner
                        message="Failed to load dashboard data. Check your API connection."
                        onRetry={handleRefresh}
                    />
                )}

                {data && (
                    <div className={`p-4 sm:p-6 space-y-6 ${refreshing ? "opacity-90 transition-opacity duration-300" : ""}`}>

                        <section aria-label="Key metrics">
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
                                <StatCard
                                    label="Active Campaigns"
                                    value={data.activeCampaigns}
                                    icon={icons.campaigns}
                                    accent
                                />
                                <StatCard
                                    label="Emails Sent Today"
                                    value={data.emailsSentToday.toLocaleString()}
                                    sub="since midnight"
                                    icon={icons.send}
                                />
                                <StatCard
                                    label="Open Rate"
                                    value={`${data.openRate}%`}
                                    trend={deltaToTrend(data.openRateDelta)}
                                    trendValue={formatDelta(data.openRateDelta)}
                                    icon={icons.openRate}
                                />
                                <StatCard
                                    label="Reply Rate"
                                    value={`${data.replyRate}%`}
                                    trend={deltaToTrend(data.replyRateDelta)}
                                    trendValue={formatDelta(data.replyRateDelta)}
                                    icon={icons.reply}
                                />
                                <StatCard
                                    label="Positive Intent"
                                    value={`${data.positiveIntentRate}%`}
                                    sub="of all replies"
                                    trend={deltaToTrend(data.positiveIntentRateDelta)}
                                    trendValue={formatDelta(data.positiveIntentRateDelta)}
                                    icon={icons.positive}
                                />
                            </div>
                        </section>

                        <LiveStatusBadges activeEvents={activeEvents} recentEvents={recentEvents} />

                        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                            <section
                                className="xl:col-span-2 min-h-[300px] flex flex-col"
                                aria-label="Pipeline activity chart"
                            >
                                <DashboardChart campaigns={data.campaigns} />
                            </section>

                            <section
                                className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 flex flex-col"
                                aria-label="Recent activity"
                            >
                                <div className="flex items-center justify-between mb-4">
                                    <h2 className="text-sm font-semibold font-display text-[var(--text-primary)]">
                                        Recent Activity
                                    </h2>
                                    {data.pendingApprovals > 0 && (
                                        <span
                                            className="text-xs font-semibold bg-[var(--red)] text-white rounded-full px-2 py-0.5 tabular-nums"
                                            aria-label={`${data.pendingApprovals} pending approvals`}
                                        >
                                            {data.pendingApprovals} pending
                                        </span>
                                    )}
                                </div>

                                {data.activityEvents.length === 0 ? (
                                    <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center py-8">
                                        <div className="w-10 h-10 rounded-full bg-[var(--surface-2)] flex items-center justify-center text-[var(--text-muted)]" aria-hidden="true">
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                                            </svg>
                                        </div>
                                        <p className="text-sm text-[var(--text-secondary)]">No activity yet</p>
                                        <p className="text-xs text-[var(--text-muted)]">Events appear here as your pipeline runs</p>
                                    </div>
                                ) : (
                                    <div className="flex-1 overflow-y-auto -mx-1 px-1">
                                        <ActivityFeed events={data.activityEvents} />
                                    </div>
                                )}
                            </section>
                        </div>

                        <section aria-label="Campaigns">
                            <CampaignTable campaigns={data.campaigns} />
                        </section>

                        {data.domains.length === 0 && data.campaigns.length === 0 && (
                            <section aria-label="Getting started" className="relative overflow-hidden bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
                                <div className="absolute inset-0 bg-gradient-to-br from-[var(--red-glow)] to-transparent pointer-events-none" aria-hidden="true" />
                                <div className="relative">
                                    <div className="flex items-center gap-2 mb-1">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--red)]" aria-hidden="true">
                                            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                                        </svg>
                                        <h2 className="text-base font-bold font-display text-[var(--text-primary)]">Get started with ScoutSend</h2>
                                    </div>
                                    <p className="text-xs text-[var(--text-muted)] mb-5">Three steps to your first AI-powered outbound campaign.</p>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                        {([
                                            { step: 1, label: "Add a sender domain", desc: "Verify your domain and start building email reputation through warm-up.", href: "/dashboard/domains" },
                                            { step: 2, label: "Connect a mailbox", desc: "Link your sending mailbox and configure daily send limits.", href: "/dashboard/mailboxes" },
                                            { step: 3, label: "Create a campaign", desc: "Define your ICP, select leads, and let AI write personalised outreach.", href: "/dashboard/campaigns" },
                                        ] as const).map(({ step, label, desc, href }) => (
                                            <a
                                                key={step}
                                                href={href}
                                                className="group flex flex-col gap-3 p-4 rounded-lg bg-[var(--navy-mid)] border border-[var(--border)] hover:border-[var(--border-red)] hover:bg-[var(--surface-2)] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                                            >
                                                <span className="w-7 h-7 rounded-full bg-[var(--red-glow)] border border-[var(--border-red)] text-[var(--red)] flex items-center justify-center text-xs font-bold flex-shrink-0">
                                                    {step}
                                                </span>
                                                <div>
                                                    <p className="text-sm font-semibold text-[var(--text-primary)] leading-tight">{label}</p>
                                                    <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">{desc}</p>
                                                </div>
                                                <span className="text-xs text-[var(--red)] font-medium flex items-center gap-1 group-hover:gap-2 transition-all duration-150" aria-hidden="true">
                                                    Get started
                                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                        <line x1="5" y1="12" x2="19" y2="12" />
                                                        <polyline points="12 5 19 12 12 19" />
                                                    </svg>
                                                </span>
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            </section>
                        )}

                        {data.domains.length > 0 ? (
                            <section aria-label="Sender domain health">
                                <h2 className="text-sm font-semibold font-display text-[var(--text-primary)] mb-3">
                                    Sender Domain Health
                                </h2>
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                                    {data.domains.map((d) => (
                                        <DomainCard
                                            key={d.id}
                                            domain={d.domain}
                                            health={d.health}
                                            reputationScore={Math.round(d.reputationScore)}
                                            sentToday={d.currentSent}
                                            dailyLimit={d.dailyLimit}
                                            bounceRate={d.bounceRate}
                                            warmupEnabled={d.warmupEnabled}
                                            warmupLimit={d.warmupLimit}
                                        />
                                    ))}
                                </div>
                            </section>
                        ) : (
                            <section aria-label="Sender domain health">
                                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl flex flex-col items-center justify-center py-10 gap-3 text-center">
                                    <div className="w-12 h-12 rounded-full bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center text-[var(--text-muted)]" aria-hidden="true">
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                            <circle cx="12" cy="12" r="10" />
                                            <line x1="2" y1="12" x2="22" y2="12" />
                                            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                                        </svg>
                                    </div>
                                    <p className="text-sm font-medium text-[var(--text-secondary)]">No sender domains configured</p>
                                    <p className="text-xs text-[var(--text-muted)] max-w-[260px]">
                                        Add a verified sending domain to protect your deliverability and warm up your reputation.
                                    </p>
                                    <a
                                        href="/dashboard/domains"
                                        className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-[var(--red-glow)] border border-[var(--border-red)] text-[var(--red)] hover:bg-[var(--red)] hover:text-white transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                                    >
                                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                            <line x1="12" y1="5" x2="12" y2="19" />
                                            <line x1="5" y1="12" x2="19" y2="12" />
                                        </svg>
                                        Add domain
                                    </a>
                                </div>
                            </section>
                        )}

                    </div>
                )}
            </div>
        </div>
    );
}