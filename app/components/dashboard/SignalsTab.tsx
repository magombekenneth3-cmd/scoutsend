"use client";

import { useState, useEffect, useCallback } from "react";

type SignalType =
    | "HIRING_SIGNAL"
    | "FUNDING_SIGNAL"
    | "GROWTH_SIGNAL"
    | "TECH_SIGNAL"
    | "INTENT_SIGNAL"
    | "RISK_SIGNAL"
    | "WEBSITE_COPY"
    | "UNKNOWN";

interface SignalLead {
    id: string;
    firstName: string | null;
    lastName: string | null;
    companyName: string;
}

interface Signal {
    id: string;
    signalType: SignalType;
    value: string;
    confidence: number;
    source: string | null;
    explanation: string | null;
    firstSeenAt: string;
    lastSeenAt: string;
    lead: SignalLead;
}

const SIGNAL_META: Record<SignalType, { label: string; bg: string; text: string; border: string }> = {
    HIRING_SIGNAL:   { label: "Hiring",    bg: "bg-violet-400/10",  text: "text-violet-400",  border: "border-violet-400/20" },
    FUNDING_SIGNAL:  { label: "Funding",   bg: "bg-emerald-400/10", text: "text-emerald-400", border: "border-emerald-400/20" },
    GROWTH_SIGNAL:   { label: "Growth",    bg: "bg-sky-400/10",     text: "text-sky-400",     border: "border-sky-400/20" },
    TECH_SIGNAL:     { label: "Tech",      bg: "bg-orange-400/10",  text: "text-orange-400",  border: "border-orange-400/20" },
    INTENT_SIGNAL:   { label: "Intent",    bg: "bg-purple-400/10",  text: "text-purple-400",  border: "border-purple-400/20" },
    RISK_SIGNAL:     { label: "Risk",      bg: "bg-red-400/10",     text: "text-red-400",     border: "border-red-400/20" },
    WEBSITE_COPY:    { label: "Website",   bg: "bg-slate-400/10",   text: "text-slate-400",   border: "border-slate-400/20" },
    UNKNOWN:         { label: "Unknown",   bg: "bg-[var(--surface-2)]", text: "text-[var(--text-muted)]", border: "border-[var(--border)]" },
};

const ALL_TYPES = Object.keys(SIGNAL_META) as SignalType[];

function relTime(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    const m = Math.floor(ms / 60_000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

function ConfidenceBar({ value }: { value: number }) {
    const pct = Math.round(value * 100);
    const color = pct >= 80 ? "bg-emerald-400" : pct >= 60 ? "bg-amber-400" : "bg-red-400";
    return (
        <div className="flex items-center gap-2 flex-shrink-0">
            <div className="w-14 h-1.5 bg-[var(--surface-2)] rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} role="progressbar" aria-valuenow={pct} aria-valuemax={100} aria-label="Signal confidence" />
            </div>
            <span className={`text-xs font-semibold tabular-nums ${color.replace("bg-", "text-")}`}>{pct}%</span>
        </div>
    );
}

interface SignalRowProps {
    signal: Signal;
}

function SignalRow({ signal }: SignalRowProps) {
    const [expanded, setExpanded] = useState(false);
    const meta = SIGNAL_META[signal.signalType] ?? SIGNAL_META.UNKNOWN;
    const name = [signal.lead.firstName, signal.lead.lastName].filter(Boolean).join(" ") || signal.lead.companyName;

    return (
        <div
            className="group border-b border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors duration-100 cursor-pointer"
            onClick={() => setExpanded((v) => !v)}
        >
            <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-4 items-center px-5 py-3.5">
                <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${meta.bg} ${meta.text} ${meta.border} whitespace-nowrap`}>
                    {meta.label}
                </span>
                <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--text-primary)] truncate">{signal.value}</p>
                    <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">
                        {name} · {signal.lead.companyName}
                        {signal.source ? ` · ${signal.source}` : ""}
                    </p>
                </div>
                <ConfidenceBar value={signal.confidence} />
                <span className="text-xs text-[var(--text-muted)] whitespace-nowrap tabular-nums hidden sm:block">
                    {relTime(signal.lastSeenAt)}
                </span>
                <svg
                    className={`text-[var(--text-muted)] transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
                    width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                >
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </div>
            {expanded && signal.explanation && (
                <div className="px-5 pb-4 pt-0 bg-[var(--surface-2)] border-t border-[var(--border)]">
                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{signal.explanation}</p>
                    <p className="text-xs text-[var(--text-muted)] mt-2">
                        First seen {relTime(signal.firstSeenAt)} · Last seen {relTime(signal.lastSeenAt)}
                    </p>
                </div>
            )}
        </div>
    );
}

interface SignalsTabProps {
    campaignId: string;
}

export function SignalsTab({ campaignId }: SignalsTabProps) {
    const [signals, setSignals] = useState<Signal[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<SignalType | "ALL">("ALL");

    const fetchSignals = useCallback(async () => {
        setError(null);
        try {
            const res = await fetch(`/api/campaigns/${campaignId}/signals`, { cache: "no-store" });
            if (!res.ok) throw new Error(`Server error ${res.status}`);
            setSignals(await res.json());
        } catch {
            setError("Failed to load signals.");
        } finally {
            setLoading(false);
        }
    }, [campaignId]);

    useEffect(() => {
        fetchSignals();
        const id = setInterval(fetchSignals, 60_000);
        return () => clearInterval(id);
    }, [fetchSignals]);

    const visible = filter === "ALL" ? signals : signals.filter((s) => s.signalType === filter);

    const counts = ALL_TYPES.reduce<Record<string, number>>((acc, t) => {
        acc[t] = signals.filter((s) => s.signalType === t).length;
        return acc;
    }, {});

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-[var(--border)] bg-[var(--navy-mid)] flex-shrink-0 overflow-x-auto">
                <button
                    onClick={() => setFilter("ALL")}
                    className={[
                        "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-150 whitespace-nowrap",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]",
                        filter === "ALL"
                            ? "bg-[var(--red-glow)] text-[var(--red)] border border-[var(--border-red)]"
                            : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)]",
                    ].join(" ")}
                >
                    All
                    <span className={`text-xs tabular-nums rounded-full px-1.5 py-0.5 ${filter === "ALL" ? "bg-[var(--red)] text-white" : "bg-[var(--surface-2)] text-[var(--text-muted)]"}`}>
                        {signals.length}
                    </span>
                </button>
                {ALL_TYPES.filter((t) => counts[t] > 0).map((t) => {
                    const meta = SIGNAL_META[t];
                    return (
                        <button
                            key={t}
                            onClick={() => setFilter(t)}
                            className={[
                                "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-150 whitespace-nowrap",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]",
                                filter === t
                                    ? `${meta.bg} ${meta.text} border ${meta.border}`
                                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)]",
                            ].join(" ")}
                        >
                            {meta.label}
                            <span className={`text-xs tabular-nums rounded-full px-1.5 py-0.5 ${filter === t ? `${meta.bg} ${meta.text}` : "bg-[var(--surface-2)] text-[var(--text-muted)]"}`}>
                                {counts[t]}
                            </span>
                        </button>
                    );
                })}
                <button
                    onClick={fetchSignals}
                    aria-label="Refresh signals"
                    className="ml-auto flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                        <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                        <path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                    </svg>
                </button>
            </div>

            <div className="flex-1 overflow-y-auto">
                {loading ? (
                    <div className="divide-y divide-[var(--border)]" aria-hidden="true">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-4 items-center px-5 py-3.5">
                                <div className="h-5 w-16 rounded-full bg-[var(--surface-2)] animate-pulse" />
                                <div className="space-y-1.5">
                                    <div className="h-3 w-48 rounded bg-[var(--surface-2)] animate-pulse" />
                                    <div className="h-2.5 w-32 rounded bg-[var(--surface-2)] animate-pulse" />
                                </div>
                                <div className="h-2 w-20 rounded-full bg-[var(--surface-2)] animate-pulse" />
                                <div className="h-2.5 w-12 rounded bg-[var(--surface-2)] animate-pulse" />
                                <div className="w-3.5 h-3.5 rounded bg-[var(--surface-2)] animate-pulse" />
                            </div>
                        ))}
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
                        <p className="text-sm text-[var(--red)]">{error}</p>
                        <button onClick={fetchSignals} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] underline">Retry</button>
                    </div>
                ) : visible.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
                        <div className="w-12 h-12 rounded-full bg-[var(--surface-2)] flex items-center justify-center text-[var(--text-muted)]">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                            </svg>
                        </div>
                        <p className="text-sm font-medium text-[var(--text-secondary)]">No signals yet</p>
                        <p className="text-xs text-[var(--text-muted)]">Signal ingestion runs continuously — check back after the pipeline starts</p>
                    </div>
                ) : (
                    <div>
                        <div className="hidden sm:grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-4 px-5 py-2.5 text-xs text-[var(--text-muted)] uppercase tracking-widest font-medium border-b border-[var(--border)] bg-[var(--navy-mid)] sticky top-0 z-10">
                            <span>Type</span>
                            <span>Signal</span>
                            <span>Confidence</span>
                            <span>Last seen</span>
                            <span />
                        </div>
                        {visible.map((s) => <SignalRow key={s.id} signal={s} />)}
                    </div>
                )}
            </div>
        </div>
    );
}
