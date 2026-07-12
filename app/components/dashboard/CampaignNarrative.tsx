"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface NarrativeStats {
    campaignId: string;
    campaignName: string;
    status: string;
    dailySendLimit: number;
    leadsFound: number;
    leadsScored: number;
    leadsQualified: number;
    leadsDisqualified: number;
    messagesGenerated: number;
    messagesPendingReview: number;
    sentToday: number;
    totalSent: number;
    delivered: number;
    opened: number;
    replied: number;
    engaged: number;
    hot: number;
    meetingBooked: number;
    disqualified: number;
}

type LineState = "done" | "active" | "pending" | "warning";

interface NarrativeLine {
    id: string;
    state: LineState;
    text: string;
    sub?: string;
    /** 0–1 fraction for active states — renders an inline progress bar. */
    progress?: number;
}

function fmt(n: number): string {
    return n.toLocaleString();
}

function pct(part: number, total: number): string {
    if (total === 0) return "0%";
    return `${Math.round((part / total) * 100)}%`;
}

const RUNNING_STATUSES = new Set([
    "RESEARCHING",
    "GENERATING",
    "REVIEW",
    "QUEUED",
    "SENDING",
]);

function buildNarrative(s: NarrativeStats): NarrativeLine[] {
    const lines: NarrativeLine[] = [];
    const status = s.status;

    if (s.leadsFound === 0) {
        lines.push({
            id: "discovery",
            state: status === "RESEARCHING" ? "active" : "pending",
            text: status === "RESEARCHING"
                ? "Searching for potential clients…"
                : "No leads found yet",
        });
    } else {
        lines.push({
            id: "discovery",
            state: "done",
            text: `Found ${fmt(s.leadsFound)} potential client${s.leadsFound !== 1 ? "s" : ""}`,
        });
    }

    if (s.leadsFound > 0) {
        const unscoredLeft = s.leadsFound - s.leadsScored;

        if (s.leadsScored === 0) {
            lines.push({
                id: "scoring",
                state: "active",
                text: "Scoring and qualifying leads…",
                progress: 0,
            });
        } else if (unscoredLeft > 0) {
            lines.push({
                id: "scoring",
                state: "active",
                text: `Scored ${fmt(s.leadsScored)} of ${fmt(s.leadsFound)} leads`,
                sub: `${fmt(s.leadsQualified)} qualified so far · ${fmt(unscoredLeft)} remaining`,
                progress: s.leadsScored / s.leadsFound,
            });
        } else {
            lines.push({
                id: "scoring",
                state: "done",
                text: `Qualified ${fmt(s.leadsQualified)} high-priority lead${s.leadsQualified !== 1 ? "s" : ""}`,
                sub: s.leadsDisqualified > 0
                    ? `${fmt(s.leadsDisqualified)} filtered out as low-fit`
                    : undefined,
            });
        }
    }

    if (s.leadsQualified > 0) {
        if (s.messagesGenerated === 0) {
            lines.push({
                id: "generate",
                state: status === "GENERATING" ? "active" : "pending",
                text: status === "GENERATING"
                    ? "Writing personalised outreach…"
                    : "Outreach not generated yet",
                progress: status === "GENERATING" ? 0 : undefined,
            });
        } else if (s.messagesGenerated < s.leadsQualified) {
            lines.push({
                id: "generate",
                state: "active",
                text: `Generating outreach — ${fmt(s.messagesGenerated)} of ${fmt(s.leadsQualified)}`,
                sub: `${pct(s.messagesGenerated, s.leadsQualified)} complete`,
                progress: s.messagesGenerated / s.leadsQualified,
            });
        } else {
            lines.push({
                id: "generate",
                state: "done",
                text: `Generated personalised outreach for ${fmt(s.messagesGenerated)} lead${s.messagesGenerated !== 1 ? "s" : ""}`,
                sub: s.messagesPendingReview > 0
                    ? `${fmt(s.messagesPendingReview)} message${s.messagesPendingReview !== 1 ? "s" : ""} awaiting your review`
                    : undefined,
            });
        }
    }

    if (s.messagesPendingReview > 0 && status === "REVIEW") {
        lines.push({
            id: "review",
            state: "warning",
            text: `${fmt(s.messagesPendingReview)} message${s.messagesPendingReview !== 1 ? "s" : ""} waiting for your approval before sending`,
        });
    }

    if (s.totalSent > 0 || status === "SENDING" || status === "QUEUED") {
        if (s.totalSent === 0) {
            lines.push({
                id: "sending",
                state: "active",
                text: "Preparing to send…",
                sub: `Up to ${fmt(s.dailySendLimit)} per day`,
            });
        } else {
            lines.push({
                id: "sending",
                state: status === "COMPLETED" ? "done" : "active",
                text: `Sending to ${fmt(s.totalSent)} lead${s.totalSent !== 1 ? "s" : ""}`,
                sub: s.sentToday > 0
                    ? `${fmt(s.sentToday)} sent today · ${fmt(s.dailySendLimit)} daily limit`
                    : `${fmt(s.dailySendLimit)} daily limit`,
            });
        }
    }

    if (s.opened > 0) {
        lines.push({
            id: "opens",
            state: "done",
            text: `${fmt(s.opened)} lead${s.opened !== 1 ? "s" : ""} opened your message`,
            sub: s.totalSent > 0 ? `${pct(s.opened, s.totalSent)} open rate` : undefined,
        });
    }

    if (s.replied > 0) {
        lines.push({
            id: "replies",
            state: "done",
            text: `${fmt(s.replied)} replied`,
            sub: s.totalSent > 0 ? `${pct(s.replied, s.totalSent)} reply rate` : undefined,
        });
    }

    if (s.hot > 0) {
        lines.push({
            id: "hot",
            state: "done",
            text: `${fmt(s.hot)} lead${s.hot !== 1 ? "s" : ""} showing strong interest`,
        });
    }

    if (s.meetingBooked > 0) {
        lines.push({
            id: "meetings",
            state: "done",
            text: `${fmt(s.meetingBooked)} meeting${s.meetingBooked !== 1 ? "s" : ""} booked`,
        });
    }

    if (status === "PAUSED") {
        lines.push({
            id: "paused",
            state: "warning",
            text: "Campaign paused",
            sub: "Resume to continue sending",
        });
    }

    if (status === "COMPLETED" && s.meetingBooked === 0 && s.replied === 0) {
        lines.push({
            id: "done",
            state: "done",
            text: "Campaign complete",
        });
    }

    return lines;
}

function IconCheck() {
    return (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
        </svg>
    );
}

function IconWarning() {
    return (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
    );
}

function IconRefresh({ spinning }: { spinning: boolean }) {
    return (
        <svg
            width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round"
            className={spinning ? "animate-spin" : ""}
            aria-hidden="true"
        >
            <path d="M21 2v6h-6" />
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
            <path d="M3 22v-6h6" />
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
        </svg>
    );
}

function TimelineDot({ state }: { state: LineState }) {
    const base = "relative z-10 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all duration-300";
    const styles: Record<LineState, string> = {
        done: `${base} bg-emerald-400 border-emerald-400 text-white`,
        active: `${base} bg-[var(--red-glow)] border-[var(--red)] text-[var(--red)]`,
        pending: `${base} bg-transparent border-[var(--border)] text-[var(--text-muted)]`,
        warning: `${base} bg-amber-400/10 border-amber-400 text-amber-400`,
    };
    return (
        <div className={styles[state]}>
            {state === "active" && (
                <span
                    className="absolute inset-0 rounded-full border-2 border-[var(--red)] animate-ping opacity-40"
                    aria-hidden="true"
                />
            )}
            {state === "done" && <IconCheck />}
            {state === "warning" && <IconWarning />}
        </div>
    );
}

function TimelineConnector({ state }: { state: LineState }) {
    const styles: Record<LineState, string> = {
        done: "bg-emerald-400/30",
        active: "bg-[var(--border)]",
        pending: "bg-[var(--border)]",
        warning: "bg-amber-400/20",
    };
    return (
        <div
            className={`w-px flex-1 mt-1 mb-1 min-h-[18px] ${styles[state]}`}
            aria-hidden="true"
        />
    );
}

function NarrativeSkeleton() {
    return (
        <div className="space-y-0" aria-label="Loading campaign progress" aria-busy="true">
            {[72, 52, 88, 44].map((w, i) => (
                <div key={i} className="flex items-start gap-3">
                    <div className="flex flex-col items-center flex-shrink-0 pt-0.5">
                        <div className="w-5 h-5 rounded-full bg-[var(--surface-2)] animate-pulse flex-shrink-0" />
                        {i < 3 && <div className="w-px flex-1 min-h-[28px] mt-1 mb-1 bg-[var(--border)]" />}
                    </div>
                    <div className="flex-1 pb-5 space-y-2 pt-0.5">
                        <div
                            className="h-3 rounded bg-[var(--surface-2)] animate-pulse"
                            style={{ width: `${w}%` }}
                        />
                        {i % 2 === 0 && (
                            <div className="h-2.5 w-36 rounded bg-[var(--surface-2)] animate-pulse" />
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}

const POLL_INTERVAL_MS = 30_000;

export function CampaignNarrative({ campaignId }: { campaignId: string }) {
    const [stats, setStats] = useState<NarrativeStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const fetchStats = useCallback(async (silent = false) => {
        const controller = new AbortController();

        if (!silent && mountedRef.current) setLoading(true);
        if (mountedRef.current) setError(null);

        try {
            const res = await fetch(`/api/campaigns/${campaignId}/narrative`, {
                signal: controller.signal,
                cache: "no-store",
            });

            if (res.status === 401 || res.status === 403) {
                if (mountedRef.current) setError("Session expired — please refresh the page.");
                return;
            }
            if (!res.ok) throw new Error(`Server error ${res.status}`);

            const data: NarrativeStats = await res.json();

            if (mountedRef.current) {
                setStats(data);
                setLastUpdated(new Date());
            }
        } catch (err) {
            if ((err as Error).name === "AbortError") return;
            if (mountedRef.current) setError("Could not load campaign progress.");
        } finally {
            if (mountedRef.current) setLoading(false);
        }

        return () => controller.abort();
    }, [campaignId]);

    useEffect(() => {
        void fetchStats(false);
    }, [fetchStats]);

    useEffect(() => {
        if (!stats || !RUNNING_STATUSES.has(stats.status)) return;
        const id = setInterval(() => { void fetchStats(true); }, POLL_INTERVAL_MS);
        return () => clearInterval(id);
    }, [fetchStats, stats?.status]);

    const lines = stats ? buildNarrative(stats) : [];
    const isRunning = stats ? RUNNING_STATUSES.has(stats.status) : false;

    const textColor: Record<LineState, string> = {
        done: "text-[var(--text-primary)]",
        active: "text-[var(--text-primary)]",
        pending: "text-[var(--text-muted)]",
        warning: "text-amber-400",
    };

    return (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
                <div>
                    <h2 className="text-sm font-semibold font-display text-[var(--text-primary)]">
                        Progress
                    </h2>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                        {isRunning && (
                            <span className="inline-flex items-center gap-1.5 mr-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-[var(--red)] animate-pulse" aria-hidden="true" />
                                Live ·
                            </span>
                        )}
                        {lastUpdated
                            ? `Updated ${lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                            : "Campaign progress at a glance"}
                    </p>
                </div>
                <button
                    onClick={() => void fetchStats(true)}
                    disabled={loading}
                    aria-label="Refresh progress"
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                >
                    <IconRefresh spinning={loading} />
                </button>
            </div>

            <div className="px-5 py-5">
                {loading && !stats ? (
                    <NarrativeSkeleton />
                ) : error ? (
                    <div className="flex items-center gap-2 py-2">
                        <p className="text-xs text-red-400">{error}</p>
                        <button
                            onClick={() => void fetchStats(false)}
                            className="text-xs text-red-400 underline hover:no-underline focus-visible:outline-none"
                        >
                            Retry
                        </button>
                    </div>
                ) : lines.length === 0 ? (
                    <p className="text-sm text-[var(--text-muted)] py-1">
                        Run the campaign to see progress here.
                    </p>
                ) : (
                    <ol className="list-none m-0 p-0" role="list" aria-label="Campaign progress steps">
                        {lines.map((line, idx) => {
                            const isLast = idx === lines.length - 1;
                            return (
                                <li key={line.id} className="flex items-start gap-3" role="listitem">
                                    <div className="flex flex-col items-center flex-shrink-0 pt-0.5">
                                        <TimelineDot state={line.state} />
                                        {!isLast && <TimelineConnector state={line.state} />}
                                    </div>
                                    <div className={`flex-1 ${isLast ? "pb-0" : "pb-5"}`}>
                                        <p className={`text-sm font-medium leading-5 ${textColor[line.state]}`}>
                                            {line.text}
                                        </p>
                                        {line.sub && (
                                            <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-4">
                                                {line.sub}
                                            </p>
                                        )}
                                        {/* Inline progress track for active steps */}
                                        {line.state === "active" && typeof line.progress === "number" && (
                                            <div
                                                className="mt-2 h-1 rounded-full bg-[var(--surface-2)] overflow-hidden"
                                                role="progressbar"
                                                aria-valuenow={Math.round(line.progress * 100)}
                                                aria-valuemin={0}
                                                aria-valuemax={100}
                                            >
                                                <div
                                                    className="h-full rounded-full bg-[var(--red)] transition-all duration-700 ease-out"
                                                    style={{ width: `${Math.max(4, line.progress * 100)}%` }}
                                                />
                                            </div>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ol>
                )}
            </div>
        </div>
    );
}