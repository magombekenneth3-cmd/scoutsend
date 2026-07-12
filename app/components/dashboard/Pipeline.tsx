"use client";

import { useState, useEffect, useCallback } from "react";
import type { CampaignStatus } from "./badges";
import { SendChart } from "./SendChart";
import { DiscoveryRunsPanel } from "./DiscoveryRunsPanel";

const FEED_ITEM_STYLE = `
@keyframes feedSlideIn {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.feed-item { animation: feedSlideIn 0.18s ease-out both; }
`;

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

interface Phase {
    id: string;
    label: string;
    sub: string;
    description: string;
    icon: React.ReactNode;
}

const PHASES: Phase[] = [
    {
        id: "RESEARCHING",
        label: "Research",
        sub: "AI-powered lead discovery",
        description: "Gemini scans the web, LinkedIn, and company data to build a qualified lead list matching your ICP.",
        icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
        ),
    },
    {
        id: "GENERATING",
        label: "Generate",
        sub: "Personalised email drafts",
        description: "For each qualified lead, the AI writes a hyper-personalised subject and body based on signals and brand settings.",
        icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
        ),
    },
    {
        id: "REVIEW",
        label: "Review",
        sub: "Human approval queue",
        description: "Generated messages enter the review queue. Reviewers approve or reject each message before it is scheduled.",
        icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
        ),
    },
    {
        id: "QUEUED",
        label: "Queue",
        sub: "Scheduled for sending",
        description: "Approved messages are queued respecting daily send limits, domain warmup schedules, and suppression lists.",
        icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
        ),
    },
    {
        id: "SENDING",
        label: "Sending",
        sub: "Live outreach in progress",
        description: "Emails are dispatched via Resend with real-time delivery tracking. Replies are classified by intent automatically.",
        icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" />
            </svg>
        ),
    },
];

const STATUS_ORDER = ["RESEARCHING", "GENERATING", "REVIEW", "QUEUED", "SENDING", "COMPLETED"];

function getPhaseState(phaseId: string, currentStatus: CampaignStatus): "done" | "active" | "pending" {
    if (currentStatus === "COMPLETED") return "done";
    if (currentStatus === "DRAFT" || currentStatus === "PAUSED" || currentStatus === "FAILED") return "pending";
    const currentIdx = STATUS_ORDER.indexOf(currentStatus);
    const phaseIdx = STATUS_ORDER.indexOf(phaseId);
    if (phaseIdx < currentIdx) return "done";
    if (phaseIdx === currentIdx) return "active";
    return "pending";
}

interface QueueJob {
    id: string;
    queueName: string;
    jobType: string;
    status: string;
    attempts: number;
    errorMessage: string | null;
    createdAt: string;
    updatedAt: string;
}

interface PipelineStats {
    leadsTotal: number;
    messagesGenerated: number;
    messagesApproved: number;
    messagesPending: number;
    messagesRejected: number;
    emailsQueued: number;
    emailsSent: number;
    emailsDelivered: number;
    emailsOpened: number;
    emailsReplied: number;
    emailsBounced: number;
    activeJob: QueueJob | null;
}

interface PipelineTabProps {
    campaignId: string;
    status: CampaignStatus;
    liveEvents?: CampaignSSEEvent[];
}

function buildFunnel(stats: PipelineStats) {
    return [
        { label: "Leads", value: stats.leadsTotal, total: stats.leadsTotal, color: "bg-violet-400" },
        { label: "Generated", value: stats.messagesGenerated, total: stats.leadsTotal, color: "bg-sky-400" },
        { label: "Approved", value: stats.messagesApproved, total: stats.messagesGenerated, color: "bg-emerald-400" },
        { label: "Pending", value: stats.messagesPending, total: null, color: "bg-amber-400" },
        { label: "Queued", value: stats.emailsQueued, total: stats.messagesApproved, color: "bg-[var(--red)]" },
        { label: "Sent", value: stats.emailsSent, total: stats.leadsTotal, color: "bg-[var(--red)]" },
        { label: "Delivered", value: stats.emailsDelivered, total: stats.emailsSent, color: "bg-emerald-400" },
        { label: "Opened", value: stats.emailsOpened, total: stats.emailsDelivered, color: "bg-sky-400" },
        { label: "Replied", value: stats.emailsReplied, total: stats.emailsOpened, color: "bg-violet-400" },
        { label: "Bounced", value: stats.emailsBounced, total: stats.emailsSent, color: "bg-red-500" },
    ];
}

export function PipelineTab({ campaignId, status, liveEvents = [] }: PipelineTabProps) {
    const [stats, setStats] = useState<PipelineStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/campaigns/${campaignId}/pipeline-stats`);
            if (!res.ok) throw new Error(`Server error ${res.status}`);
            const data: PipelineStats = await res.json();
            setStats(data);
        } catch {
            setError("Failed to load pipeline data.");
        } finally {
            setLoading(false);
        }
    }, [campaignId]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const funnel = stats ? buildFunnel(stats) : [];

    return (
        <div className="px-4 sm:px-6 py-6 max-w-5xl mx-auto space-y-6">
            <style dangerouslySetInnerHTML={{ __html: FEED_ITEM_STYLE }} />

            <section aria-label="Pipeline phases">
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                    <div className="px-5 py-4 border-b border-[var(--border)]">
                        <h2 className="text-sm font-semibold font-display text-[var(--text-primary)]">
                            Pipeline Phases
                        </h2>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            5-stage AI automation pipeline
                        </p>
                    </div>

                    <div className="p-6">
                        <ol
                            className="hidden sm:flex items-start gap-0"
                            aria-label="Pipeline stages"
                        >
                            {PHASES.map((phase, idx) => {
                                const state = getPhaseState(phase.id, status);
                                return (
                                    <li key={phase.id} className="flex-1 flex flex-col items-center text-center relative">
                                        {idx < PHASES.length - 1 && (
                                            <div
                                                className="absolute top-5 left-1/2 w-full h-px"
                                                style={{
                                                    background: state === "done"
                                                        ? "linear-gradient(90deg, var(--red), rgba(233,69,96,0.3))"
                                                        : "var(--border)",
                                                }}
                                                aria-hidden="true"
                                            />
                                        )}
                                        <div
                                            className={[
                                                "relative z-10 w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all duration-300",
                                                state === "done"
                                                    ? "bg-[var(--red)] border-[var(--red)] text-white"
                                                    : state === "active"
                                                        ? "bg-[var(--red-glow)] border-[var(--red)] text-[var(--red)]"
                                                        : "bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-muted)]",
                                            ].join(" ")}
                                            aria-current={state === "active" ? "step" : undefined}
                                        >
                                            {state === "active" && (
                                                <span className="absolute inset-0 rounded-full border-2 border-[var(--red)] animate-ping opacity-40" aria-hidden="true" />
                                            )}
                                            {state === "done" ? (
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-label="Completed">
                                                    <polyline points="20 6 9 17 4 12" />
                                                </svg>
                                            ) : (
                                                phase.icon
                                            )}
                                        </div>
                                        <p className={[
                                            "text-xs font-semibold mt-3",
                                            state === "active" ? "text-[var(--red)]" : state === "done" ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]",
                                        ].join(" ")}>
                                            {phase.label}
                                        </p>
                                        <p className="text-xs text-[var(--text-muted)] mt-0.5">
                                            {phase.sub}
                                        </p>
                                    </li>
                                );
                            })}
                        </ol>

                        <ol className="sm:hidden space-y-2" aria-label="Pipeline stages">
                            {PHASES.map((phase) => {
                                const state = getPhaseState(phase.id, status);
                                return (
                                    <li
                                        key={phase.id}
                                        className={[
                                            "flex items-center gap-3 px-3 py-2.5 rounded-lg",
                                            state === "active" ? "bg-[var(--red-glow)] border border-[var(--border-red)]" : "border border-transparent",
                                        ].join(" ")}
                                        aria-current={state === "active" ? "step" : undefined}
                                    >
                                        <div className={[
                                            "w-7 h-7 rounded-full border flex items-center justify-center flex-shrink-0",
                                            state === "done" ? "bg-[var(--red)] border-[var(--red)] text-white" :
                                                state === "active" ? "border-[var(--red)] text-[var(--red)]" :
                                                    "border-[var(--border)] text-[var(--text-muted)]",
                                        ].join(" ")}>
                                            {state === "done" ? (
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-label="Done">
                                                    <polyline points="20 6 9 17 4 12" />
                                                </svg>
                                            ) : phase.icon}
                                        </div>
                                        <div className="min-w-0">
                                            <p className={`text-xs font-semibold ${state === "active" ? "text-[var(--red)]" : state === "done" ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}>
                                                {phase.label}
                                            </p>
                                            <p className="text-xs text-[var(--text-muted)] truncate">{phase.sub}</p>
                                        </div>
                                    </li>
                                );
                            })}
                        </ol>

                        {PHASES.map((phase) => {
                            if (getPhaseState(phase.id, status) !== "active") return null;
                            const latestEvent = liveEvents[0];
                            const progress = latestEvent?.progress ?? 0;
                            return (
                                <div key={phase.id} className="mt-6 space-y-3">
                                    <div className="p-4 bg-[var(--red-glow)] border border-[var(--border-red)] rounded-xl">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                                <span className="text-[var(--red)] flex-shrink-0">{phase.icon}</span>
                                                <p className="text-sm font-semibold text-[var(--red)]">Currently: {phase.label}</p>
                                            </div>
                                            {liveEvents.length > 0 && (
                                                <span className="text-[10px] tabular-nums font-mono text-[var(--text-muted)]">{progress}%</span>
                                            )}
                                        </div>
                                        {liveEvents.length > 0 ? (
                                            <div className="h-1 bg-[var(--surface-2)] rounded-full overflow-hidden mb-3">
                                                <div
                                                    className="h-full rounded-full bg-[var(--red)] transition-all duration-700"
                                                    style={{ width: `${progress}%` }}
                                                    role="progressbar"
                                                    aria-valuenow={progress}
                                                    aria-valuemax={100}
                                                    aria-label={`Research progress ${progress}%`}
                                                />
                                            </div>
                                        ) : null}
                                        <p className="text-sm text-[var(--text-secondary)] mt-0.5">{phase.description}</p>
                                    </div>

                                    {liveEvents.length > 0 && (
                                        <div
                                            className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden"
                                            aria-live="polite"
                                            aria-label="Research activity feed"
                                        >
                                            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)]">
                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
                                                <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Live Activity</p>
                                            </div>
                                            <ul className="divide-y divide-[var(--border)] max-h-52 overflow-y-auto">
                                                {liveEvents.map((ev) => (
                                                    <li
                                                        key={ev.timestamp}
                                                        className="feed-item flex items-baseline gap-2.5 px-4 py-2 text-xs"
                                                    >
                                                        <span className="text-emerald-400 flex-shrink-0" aria-hidden="true">✓</span>
                                                        <span className="text-[var(--text-primary)] truncate">{ev.detail}</span>
                                                        <span className="ml-auto text-[var(--text-muted)] font-mono tabular-nums flex-shrink-0 text-[10px]">
                                                            {new Date(ev.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                                                        </span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </section>

            <section aria-label="Pipeline progress">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold text-[var(--text-primary)]">Progress</h2>
                    <button
                        onClick={fetchData}
                        disabled={loading}
                        aria-label="Refresh pipeline stats"
                        className="flex items-center justify-center w-7 h-7 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={loading ? "animate-spin" : ""} aria-hidden="true">
                            <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                            <path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                        </svg>
                    </button>
                </div>

                {error && (
                    <div role="alert" className="flex items-center gap-2 p-3 bg-red-400/5 border border-red-400/20 rounded-xl mb-4">
                        <p className="text-xs text-red-400">{error}</p>
                        <button onClick={fetchData} className="ml-auto text-xs text-red-400 hover:underline focus-visible:outline-none">Retry</button>
                    </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    {loading
                        ? Array.from({ length: 10 }).map((_, i) => (
                            <div key={i} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-3" aria-hidden="true">
                                <div className="h-2.5 w-20 rounded bg-[var(--surface-2)] animate-pulse" />
                                <div className="h-7 w-12 rounded bg-[var(--surface-2)] animate-pulse" />
                                <div className="h-1 w-full rounded-full bg-[var(--surface-2)] animate-pulse" />
                            </div>
                        ))
                        : funnel.map((s) => (
                            <div key={s.label} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
                                <div className="flex items-end justify-between mb-3">
                                    <span className="text-xs text-[var(--text-muted)] uppercase tracking-widest font-medium leading-tight">
                                        {s.label}
                                    </span>
                                    {s.total !== null && s.total > 0 && (
                                        <span className="text-xs text-[var(--text-muted)] tabular-nums">
                                            /{s.total.toLocaleString()}
                                        </span>
                                    )}
                                </div>
                                <p className="text-2xl font-bold font-display text-[var(--text-primary)] tabular-nums leading-none mb-3">
                                    {s.value.toLocaleString()}
                                </p>
                                {s.total !== null && s.total > 0 && (
                                    <div className="h-1 bg-[var(--surface-2)] rounded-full overflow-hidden">
                                        <div
                                            className={`h-full rounded-full transition-all duration-700 ${s.color}`}
                                            style={{ width: `${Math.min((s.value / s.total) * 100, 100)}%` }}
                                            role="progressbar"
                                            aria-valuenow={s.value}
                                            aria-valuemax={s.total}
                                            aria-label={`${s.label}: ${s.value} of ${s.total}`}
                                        />
                                    </div>
                                )}
                            </div>
                        ))
                    }
                </div>
            </section>

            <section aria-label="Active queue job">
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
                        <h2 className="text-sm font-semibold font-display text-[var(--text-primary)]">
                            Active Queue Job
                        </h2>
                        {!loading && stats?.activeJob && (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-emerald-400/10 text-emerald-400 px-2.5 py-1 rounded-full">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
                                Active
                            </span>
                        )}
                        {!loading && !stats?.activeJob && (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-[var(--surface-2)] text-[var(--text-muted)] px-2.5 py-1 rounded-full border border-[var(--border)]">
                                Idle
                            </span>
                        )}
                    </div>

                    {loading ? (
                        <div className="px-5 py-4 grid grid-cols-2 md:grid-cols-4 gap-4" aria-hidden="true">
                            {Array.from({ length: 4 }).map((_, i) => (
                                <div key={i} className="space-y-2">
                                    <div className="h-2.5 w-16 rounded bg-[var(--surface-2)] animate-pulse" />
                                    <div className="h-4 w-24 rounded bg-[var(--surface-2)] animate-pulse" />
                                </div>
                            ))}
                        </div>
                    ) : stats?.activeJob ? (
                        <dl className="px-5 py-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                            {[
                                { label: "Queue", value: stats.activeJob.queueName },
                                { label: "Job Type", value: stats.activeJob.jobType },
                                { label: "Attempts", value: String(stats.activeJob.attempts) },
                                { label: "Started", value: new Date(stats.activeJob.createdAt).toLocaleTimeString() },
                            ].map((item) => (
                                <div key={item.label}>
                                    <dt className="text-xs text-[var(--text-muted)] uppercase tracking-widest font-medium mb-1">
                                        {item.label}
                                    </dt>
                                    <dd className="text-sm text-[var(--text-primary)] font-mono">{item.value}</dd>
                                </div>
                            ))}
                        </dl>
                    ) : (
                        <div className="px-5 py-8 text-center">
                            <p className="text-sm text-[var(--text-muted)]">No active queue job for this campaign.</p>
                            <p className="text-xs text-[var(--text-muted)] mt-1">Run the pipeline to start processing.</p>
                        </div>
                    )}
                </div>
            </section>

            <SendChart campaignId={campaignId} />

            <DiscoveryRunsPanel campaignId={campaignId} />

        </div>
    );
}