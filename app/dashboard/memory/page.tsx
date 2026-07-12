"use client";

import { useEffect, useState, useCallback } from "react";
import { TopBar } from "@/app/components/dashboard/TopBar";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MemoryStats {
    winCount: number;
    lossCount: number;
    winToLossRatio: number | null;
    recentWins: {
        signalType: string;
        subjectPattern: string;
        replyIntent: string;
        createdAt: string;
    }[];
    topSignals: { signalType: string; count: number }[];
}

interface WinPattern {
    signalType: string;
    signalValue: string;
    subjectPattern: string;
    bodyOpeningPattern: string;
    tone: string | null;
    replyIntent: string;
    frequency: number;
    recencyScore: number;
}

interface LossPattern {
    inferredObjection: string;
    bodyPattern: string | null;
    tone: string | null;
    frequency: number;
    recencyScore: number;
}

type Tab = "overview" | "wins" | "losses";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60_000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

const SIGNAL_LABELS: Record<string, string> = {
    HIRING_SIGNAL: "Hiring",
    FUNDING_SIGNAL: "Funding",
    GROWTH_SIGNAL: "Growth",
    TECH_SIGNAL: "Tech",
    INTENT_SIGNAL: "Intent",
    RISK_SIGNAL: "Risk",
    WEBSITE_COPY: "Website",
    UNKNOWN: "Unknown",
};

const SIGNAL_COLOURS: Record<string, string> = {
    HIRING_SIGNAL: "text-sky-400 bg-sky-400/10 border-sky-400/20",
    FUNDING_SIGNAL: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
    GROWTH_SIGNAL: "text-violet-400 bg-violet-400/10 border-violet-400/20",
    TECH_SIGNAL: "text-amber-400 bg-amber-400/10 border-amber-400/20",
    INTENT_SIGNAL: "text-pink-400 bg-pink-400/10 border-pink-400/20",
    RISK_SIGNAL: "text-rose-400 bg-rose-400/10 border-rose-400/20",
    WEBSITE_COPY: "text-teal-400 bg-teal-400/10 border-teal-400/20",
    UNKNOWN: "text-[var(--text-muted)] bg-[var(--surface-2)] border-[var(--border)]",
};

const TONE_COLOURS: Record<string, string> = {
    "peer-to-peer": "text-sky-400 bg-sky-400/10 border-sky-400/20",
    challenger: "text-rose-400 bg-rose-400/10 border-rose-400/20",
    curious: "text-violet-400 bg-violet-400/10 border-violet-400/20",
    direct: "text-amber-400 bg-amber-400/10 border-amber-400/20",
    warm: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
    salesy: "text-rose-400 bg-rose-400/10 border-rose-400/20",
    generic: "text-[var(--text-muted)] bg-[var(--surface-2)] border-[var(--border)]",
};

function Pill({ label, colour }: { label: string; colour: string }) {
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${colour}`}>
            {label}
        </span>
    );
}

function Skeleton({ className }: { className?: string }) {
    return <div className={`animate-pulse rounded-lg bg-[var(--surface-2)] ${className ?? ""}`} />;
}

function RecencyBar({ score }: { score: number }) {
    const pct = Math.round(score * 100);
    const colour =
        pct >= 70 ? "bg-emerald-500" :
            pct >= 40 ? "bg-amber-500" :
                "bg-rose-500";
    return (
        <div className="flex items-center gap-2">
            <div className="flex-1 h-1 rounded-full bg-[var(--surface-2)]">
                <div className={`h-1 rounded-full ${colour}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[10px] text-[var(--text-muted)] w-8 text-right tabular-nums">{pct}%</span>
        </div>
    );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
    label,
    value,
    sub,
    accent,
}: {
    label: string;
    value: string | number;
    sub?: string;
    accent?: string;
}) {
    return (
        <div className="flex flex-col gap-1 border border-[var(--border)] rounded-xl p-4 bg-[var(--surface)]">
            <span className="text-xs text-[var(--text-muted)]">{label}</span>
            <span className={`text-2xl font-semibold tabular-nums ${accent ?? "text-[var(--text-primary)]"}`}>
                {value}
            </span>
            {sub && <span className="text-xs text-[var(--text-muted)]">{sub}</span>}
        </div>
    );
}

function WinCard({ pattern }: { pattern: WinPattern }) {
    return (
        <div className="border border-[var(--border)] rounded-xl p-4 bg-[var(--surface)] flex flex-col gap-3 hover:border-emerald-500/30 transition-colors">
            <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium text-[var(--text-primary)] leading-snug flex-1">
                    "{pattern.subjectPattern}"
                </p>
                <div className="flex items-center gap-1 flex-shrink-0">
                    {pattern.replyIntent === "MEETING_REQUEST" && (
                        <Pill label="Meeting" colour="text-emerald-400 bg-emerald-400/10 border-emerald-400/20" />
                    )}
                    {pattern.replyIntent === "POSITIVE" && (
                        <Pill label="Positive" colour="text-sky-400 bg-sky-400/10 border-sky-400/20" />
                    )}
                </div>
            </div>

            <p className="text-xs text-[var(--text-secondary)] italic leading-relaxed">
                "{pattern.bodyOpeningPattern}"
            </p>

            <div className="flex items-center gap-2 flex-wrap">
                <Pill
                    label={SIGNAL_LABELS[pattern.signalType] ?? pattern.signalType}
                    colour={SIGNAL_COLOURS[pattern.signalType] ?? SIGNAL_COLOURS.UNKNOWN}
                />
                {pattern.tone && (
                    <Pill
                        label={pattern.tone}
                        colour={TONE_COLOURS[pattern.tone] ?? TONE_COLOURS.generic}
                    />
                )}
                <span className="text-[10px] text-[var(--text-muted)] ml-auto">
                    ×{pattern.frequency} occurrences
                </span>
            </div>

            <div className="pt-1 border-t border-[var(--border)]">
                <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-[var(--text-muted)]">Recency</span>
                </div>
                <RecencyBar score={pattern.recencyScore} />
            </div>
        </div>
    );
}

function LossCard({ pattern }: { pattern: LossPattern }) {
    return (
        <div className="border border-[var(--border)] rounded-xl p-4 bg-[var(--surface)] flex flex-col gap-3 hover:border-rose-500/30 transition-colors">
            <div className="flex items-start gap-3">
                <div className="mt-0.5 w-4 h-4 rounded-full bg-rose-500/20 border border-rose-500/30 flex items-center justify-center flex-shrink-0">
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-rose-400">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                </div>
                <p className="text-sm font-medium text-[var(--text-primary)] leading-snug">
                    {pattern.inferredObjection}
                </p>
            </div>

            {pattern.bodyPattern && (
                <p className="text-xs text-[var(--text-secondary)] italic leading-relaxed pl-7">
                    "{pattern.bodyPattern}"
                </p>
            )}

            <div className="flex items-center gap-2 flex-wrap pl-7">
                {pattern.tone && (
                    <Pill
                        label={pattern.tone}
                        colour={TONE_COLOURS[pattern.tone] ?? TONE_COLOURS.generic}
                    />
                )}
                <span className="text-[10px] text-[var(--text-muted)] ml-auto">
                    ×{pattern.frequency} occurrences
                </span>
            </div>

            <div className="pt-1 border-t border-[var(--border)]">
                <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-[var(--text-muted)]">Recency</span>
                </div>
                <RecencyBar score={pattern.recencyScore} />
            </div>
        </div>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MemoryPage() {
    const [tab, setTab] = useState<Tab>("overview");
    const [stats, setStats] = useState<MemoryStats | null>(null);
    const [wins, setWins] = useState<WinPattern[]>([]);
    const [losses, setLosses] = useState<LossPattern[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [sRes, wRes, lRes] = await Promise.all([
                fetch("/api/memory/stats"),
                fetch("/api/memory/wins?limit=20"),
                fetch("/api/memory/losses?limit=20"),
            ]);

            if (!sRes.ok || !wRes.ok || !lRes.ok) {
                throw new Error("Failed to load memory data");
            }

            const [s, w, l] = await Promise.all([
                sRes.json(),
                wRes.json(),
                lRes.json(),
            ]);

            setStats(s);
            setWins(w.data ?? []);
            setLosses(l.data ?? []);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Unknown error");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const winRate = stats
        ? stats.winCount + stats.lossCount > 0
            ? Math.round((stats.winCount / (stats.winCount + stats.lossCount)) * 100)
            : 0
        : null;

    const TABS: { id: Tab; label: string; count?: number }[] = [
        { id: "overview", label: "Overview" },
        { id: "wins", label: "Win patterns", count: wins.length },
        { id: "losses", label: "Loss patterns", count: losses.length },
    ];

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <TopBar title="AI Memory" />

            <div className="flex-1 overflow-y-auto p-6">

                {/* Header */}
                <div className="mb-6">
                    <h1 className="text-lg font-semibold text-[var(--text-primary)]">What the AI has learned</h1>
                    <p className="text-sm text-[var(--text-muted)] mt-1">
                        Every positive and negative reply is analysed and stored as a pattern. These patterns feed directly into future email generation.
                    </p>
                </div>

                {/* Tabs */}
                <div className="flex items-center gap-1 mb-6 border-b border-[var(--border)]">
                    {TABS.map((t) => (
                        <button
                            key={t.id}
                            onClick={() => setTab(t.id)}
                            className={[
                                "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
                                tab === t.id
                                    ? "border-[var(--red)] text-[var(--red)]"
                                    : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                            ].join(" ")}
                        >
                            {t.label}
                            {t.count != null && t.count > 0 && (
                                <span className="text-[10px] font-semibold bg-[var(--surface-2)] text-[var(--text-muted)] rounded-full px-1.5 py-0.5">
                                    {t.count}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                {/* Error */}
                {error && (
                    <div className="flex items-center gap-3 p-4 bg-[var(--red-glow)] border border-[var(--border-red)] rounded-xl mb-6">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--red)] flex-shrink-0">
                            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                        <p className="text-sm text-[var(--red)]">{error}</p>
                        <button onClick={load} className="ml-auto text-xs text-[var(--red)] underline">Retry</button>
                    </div>
                )}

                {/* ── OVERVIEW TAB ── */}
                {tab === "overview" && (
                    <div className="space-y-6">

                        {/* Stat cards */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {loading ? (
                                Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)
                            ) : (
                                <>
                                    <StatCard
                                        label="Total wins"
                                        value={stats?.winCount ?? 0}
                                        sub="positive / meeting replies"
                                        accent="text-emerald-400"
                                    />
                                    <StatCard
                                        label="Total losses"
                                        value={stats?.lossCount ?? 0}
                                        sub="negative / not interested"
                                        accent="text-rose-400"
                                    />
                                    <StatCard
                                        label="Win rate"
                                        value={winRate != null ? `${winRate}%` : "—"}
                                        sub="wins ÷ total replies"
                                        accent={winRate != null && winRate >= 30 ? "text-emerald-400" : "text-amber-400"}
                                    />
                                    <StatCard
                                        label="Win / Loss ratio"
                                        value={stats?.winToLossRatio ?? "—"}
                                        sub=">1.0 is healthy"
                                        accent={
                                            stats?.winToLossRatio != null && stats.winToLossRatio >= 1
                                                ? "text-emerald-400"
                                                : "text-rose-400"
                                        }
                                    />
                                </>
                            )}
                        </div>

                        {/* Top signals */}
                        <div className="border border-[var(--border)] rounded-xl p-5 bg-[var(--surface)]">
                            <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Top winning signals</h2>
                            {loading ? (
                                <div className="space-y-3">
                                    {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-6" />)}
                                </div>
                            ) : stats?.topSignals.length === 0 ? (
                                <p className="text-sm text-[var(--text-muted)]">No signal data yet.</p>
                            ) : (
                                <div className="space-y-3">
                                    {stats?.topSignals.map((s) => {
                                        const max = stats.topSignals[0]?.count ?? 1;
                                        const pct = Math.round((s.count / max) * 100);
                                        return (
                                            <div key={s.signalType} className="flex items-center gap-3">
                                                <Pill
                                                    label={SIGNAL_LABELS[s.signalType] ?? s.signalType}
                                                    colour={SIGNAL_COLOURS[s.signalType] ?? SIGNAL_COLOURS.UNKNOWN}
                                                />
                                                <div className="flex-1 h-1.5 rounded-full bg-[var(--surface-2)]">
                                                    <div
                                                        className="h-1.5 rounded-full bg-emerald-500"
                                                        style={{ width: `${pct}%` }}
                                                    />
                                                </div>
                                                <span className="text-xs text-[var(--text-muted)] tabular-nums w-6 text-right">
                                                    {s.count}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Recent wins */}
                        <div className="border border-[var(--border)] rounded-xl p-5 bg-[var(--surface)]">
                            <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Recent wins</h2>
                            {loading ? (
                                <div className="space-y-3">
                                    {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
                                </div>
                            ) : stats?.recentWins.length === 0 ? (
                                <p className="text-sm text-[var(--text-muted)]">No wins recorded yet. Run a campaign to start building memory.</p>
                            ) : (
                                <div className="divide-y divide-[var(--border)]">
                                    {stats?.recentWins.map((w, i) => (
                                        <div key={i} className="py-3 flex items-start gap-3">
                                            <div className="mt-0.5 w-4 h-4 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
                                                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-emerald-400">
                                                    <polyline points="20 6 9 17 4 12" />
                                                </svg>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm text-[var(--text-primary)] truncate">
                                                    "{w.subjectPattern}"
                                                </p>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <Pill
                                                        label={SIGNAL_LABELS[w.signalType] ?? w.signalType}
                                                        colour={SIGNAL_COLOURS[w.signalType] ?? SIGNAL_COLOURS.UNKNOWN}
                                                    />
                                                    <span className="text-[10px] text-[var(--text-muted)]">
                                                        {timeAgo(w.createdAt)}
                                                    </span>
                                                </div>
                                            </div>
                                            {w.replyIntent === "MEETING_REQUEST" && (
                                                <span className="text-[10px] font-semibold text-emerald-400 border border-emerald-400/30 bg-emerald-400/10 rounded-full px-2 py-0.5 flex-shrink-0">
                                                    Meeting
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ── WINS TAB ── */}
                {tab === "wins" && (
                    <div>
                        {loading ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-48" />)}
                            </div>
                        ) : wins.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 text-center">
                                <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-4">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="text-emerald-400">
                                        <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                </div>
                                <p className="text-sm font-medium text-[var(--text-primary)]">No win patterns yet</p>
                                <p className="text-xs text-[var(--text-muted)] mt-1 max-w-xs">
                                    Win patterns are extracted automatically when a prospect replies positively or books a meeting.
                                </p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {wins.map((w, i) => <WinCard key={i} pattern={w} />)}
                            </div>
                        )}
                    </div>
                )}

                {/* ── LOSSES TAB ── */}
                {tab === "losses" && (
                    <div>
                        {loading ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
                            </div>
                        ) : losses.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 text-center">
                                <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mb-4">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="text-rose-400">
                                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                    </svg>
                                </div>
                                <p className="text-sm font-medium text-[var(--text-primary)]">No loss patterns yet</p>
                                <p className="text-xs text-[var(--text-muted)] mt-1 max-w-xs">
                                    Loss patterns are extracted when a prospect replies negatively or marks as not interested.
                                </p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {losses.map((l, i) => <LossCard key={i} pattern={l} />)}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}