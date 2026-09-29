"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface Campaign {
    id: string;
    name: string;
}

interface CompetitorInsight {
    id: string;
    tool: string;
    painPoint: string;
    sentiment: string;
    source: string;
    severity: string;
    userFixesIt: boolean | null;
    userNote: string | null;
}

type ToolGroup = { tool: string; insights: CompetitorInsight[]; leadCount: number };

function displayName(tool: string): string {
    const base = tool.split(".")[0] ?? tool;
    return base.charAt(0).toUpperCase() + base.slice(1);
}

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1 };

function SeverityBadge({ severity }: { severity: string }) {
    return (
        <span
            className={[
                "inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide",
                severity === "high"
                    ? "bg-[var(--red-glow)] text-[var(--red-text)]"
                    : "bg-[var(--surface-2)] text-[var(--text-muted)]",
            ].join(" ")}
        >
            {severity === "high" ? "⚡ High" : "· Medium"}
        </span>
    );
}

function SourceBadge({ source }: { source: string }) {
    return (
        <span className="inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full bg-[var(--surface-2)] text-[var(--text-muted)] border border-[var(--border)]">
            {source}
        </span>
    );
}

function PainPointCard({
    insight,
    onAnswer,
}: {
    insight: CompetitorInsight;
    onAnswer: (id: string, fixes: boolean | null, note?: string) => void;
}) {
    const [note, setNote] = useState(insight.userNote ?? "");
    const [showNote, setShowNote] = useState(!!insight.userNote);
    const [saving, setSaving] = useState(false);

    const answer = async (fixes: boolean | null) => {
        setSaving(true);
        await onAnswer(insight.id, fixes, note.trim() || undefined);
        setSaving(false);
    };

    const saveNote = async () => {
        setSaving(true);
        await onAnswer(insight.id, insight.userFixesIt, note.trim() || undefined);
        setSaving(false);
    };

    const answered = insight.userFixesIt !== null;

    return (
        <div
            className={[
                "rounded-xl border p-4 transition-all duration-200",
                insight.userFixesIt === true
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : insight.userFixesIt === false
                    ? "border-[var(--border)] bg-[var(--surface)] opacity-60"
                    : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-red)]/40",
            ].join(" ")}
        >
            <div className="flex items-start justify-between gap-3 mb-3">
                <p className="text-sm text-[var(--text-primary)] leading-snug flex-1">
                    {insight.painPoint}
                </p>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                    <SeverityBadge severity={insight.severity} />
                    <SourceBadge source={insight.source} />
                </div>
            </div>

            <div className="flex items-center gap-2">
                <button
                    onClick={() => answer(true)}
                    disabled={saving}
                    aria-pressed={insight.userFixesIt === true}
                    className={[
                        "flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all duration-150",
                        insight.userFixesIt === true
                            ? "bg-emerald-500 border-emerald-500 text-white"
                            : "border-[var(--border)] text-[var(--text-secondary)] hover:border-emerald-500/50 hover:text-emerald-400",
                    ].join(" ")}
                >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="20 6 9 17 4 12" />
                    </svg>
                    We fix this
                </button>

                <button
                    onClick={() => answer(false)}
                    disabled={saving}
                    aria-pressed={insight.userFixesIt === false}
                    className={[
                        "flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all duration-150",
                        insight.userFixesIt === false
                            ? "bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-muted)]"
                            : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border)] hover:text-[var(--text-primary)]",
                    ].join(" ")}
                >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                    Not yet
                </button>

                {answered && (
                    <button
                        onClick={() => setShowNote((v) => !v)}
                        className="ml-auto text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                    >
                        {showNote ? "Hide note" : insight.userNote ? "Edit note" : "Add note"}
                    </button>
                )}
            </div>

            {answered && showNote && (
                <div className="mt-3 flex gap-2">
                    <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="How does your product address this? (used to personalise emails)"
                        rows={2}
                        className="flex-1 text-xs bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] resize-none focus:outline-none focus:border-[var(--border-red)] transition-colors"
                    />
                    <button
                        onClick={saveNote}
                        disabled={saving}
                        className="self-end text-xs font-semibold px-3 py-2 rounded-lg bg-[var(--red)] text-white hover:bg-[var(--red-dim)] transition-colors disabled:opacity-50"
                    >
                        Save
                    </button>
                </div>
            )}
        </div>
    );
}

function ToolCard({
    group,
    onAnswer,
    onRefresh,
    refreshing,
}: {
    group: ToolGroup;
    onAnswer: (id: string, fixes: boolean | null, note?: string) => void;
    onRefresh: (tool: string) => void;
    refreshing: boolean;
}) {
    const [expanded, setExpanded] = useState(true);
    const confirmed = group.insights.filter((i) => i.userFixesIt === true).length;
    const total = group.insights.length;

    return (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
            <div
                className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-[var(--surface-2)] transition-colors"
                onClick={() => setExpanded((v) => !v)}
            >
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--red-text)]" aria-hidden="true">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        </svg>
                    </div>
                    <div>
                        <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                            {displayName(group.tool)}
                        </h2>
                        <p className="text-xs text-[var(--text-muted)]">
                            {group.leadCount > 0 ? `${group.leadCount} lead${group.leadCount !== 1 ? "s" : ""} using this` : group.tool}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="text-right">
                        <p className="text-xs font-semibold text-[var(--text-primary)]">
                            {confirmed}/{total}
                        </p>
                        <p className="text-[10px] text-[var(--text-muted)]">confirmed</p>
                    </div>
                    <div className="w-20 h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden">
                        <div
                            className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                            style={{ width: total > 0 ? `${(confirmed / total) * 100}%` : "0%" }}
                        />
                    </div>
                    <button
                        onClick={(e) => { e.stopPropagation(); onRefresh(group.tool); }}
                        disabled={refreshing}
                        aria-label="Refresh pain points"
                        title="Re-fetch pain points from Gemini"
                        className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-2)] transition-colors disabled:opacity-40"
                    >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={refreshing ? "animate-spin" : ""} aria-hidden="true">
                            <polyline points="23 4 23 10 17 10" />
                            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                        </svg>
                    </button>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-[var(--text-muted)] transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} aria-hidden="true">
                        <polyline points="6 9 12 15 18 9" />
                    </svg>
                </div>
            </div>

            {expanded && (
                <div className="px-5 pb-5 space-y-3 border-t border-[var(--border)]/50">
                    <div className="pt-4 space-y-3">
                        {[...group.insights]
                            .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 1) - (SEVERITY_ORDER[b.severity] ?? 1))
                            .map((insight) => (
                                <PainPointCard key={insight.id} insight={insight} onAnswer={onAnswer} />
                            ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function AddCompetitorModal({
    campaigns,
    onAdd,
    onClose,
}: {
    campaigns: Campaign[];
    onAdd: (tool: string, campaignId?: string) => Promise<void>;
    onClose: () => void;
}) {
    const [tool, setTool] = useState("");
    const [campaignId, setCampaignId] = useState<string>(campaigns[0]?.id ?? "");
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { inputRef.current?.focus(); }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const normalized = tool.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
        if (!normalized) { setErr("Enter a competitor domain"); return; }
        setSaving(true);
        setErr("");
        try {
            await onAdd(normalized, campaignId || undefined);
            onClose();
        } catch (e) {
            setErr(e instanceof Error ? e.message : "Failed to add competitor");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <form
                onSubmit={handleSubmit}
                className="relative z-10 w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)] p-6 flex flex-col gap-5"
            >
                <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--red-text)]" aria-hidden="true">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        </svg>
                        Add Competitor
                    </h2>
                    <button type="button" onClick={onClose} className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>

                <div className="flex flex-col gap-3">
                    <div>
                        <label className="text-xs font-medium text-[var(--text-secondary)] mb-1.5 block">Competitor domain</label>
                        <input
                            ref={inputRef}
                            type="text"
                            value={tool}
                            onChange={(e) => setTool(e.target.value)}
                            placeholder="e.g. hubspot.com, salesloft.com"
                            className="w-full text-sm bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-red)] transition-colors"
                        />
                    </div>

                    {campaigns.length > 0 && (
                        <div>
                            <label className="text-xs font-medium text-[var(--text-secondary)] mb-1.5 block">Associate with campaign <span className="text-[var(--text-muted)] font-normal">(optional — tags its leads for displacement)</span></label>
                            <select
                                value={campaignId}
                                onChange={(e) => setCampaignId(e.target.value)}
                                className="w-full text-sm bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-red)] transition-colors appearance-none"
                            >
                                <option value="">No campaign — insight only</option>
                                {campaigns.map((c) => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {err && <p className="text-xs text-[var(--red-text)]">{err}</p>}
                </div>

                <div className="flex justify-end gap-2">
                    <button type="button" onClick={onClose} className="text-xs font-semibold px-4 py-2 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-2)] transition-colors">
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={saving || !tool.trim()}
                        className="flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-lg bg-[var(--red)] text-white hover:bg-[var(--red-dim)] transition-colors disabled:opacity-50"
                    >
                        {saving ? (
                            <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                            </svg>
                        ) : (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                        )}
                        {saving ? "Fetching insights…" : "Add Competitor"}
                    </button>
                </div>
            </form>
        </div>
    );
}

const useLeadTools = (): { tools: string[]; leadCounts: Record<string, number>; loading: boolean } => {
    const [tools, setTools] = useState<string[]>([]);
    const [leadCounts, setLeadCounts] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchLeadTools() {
            try {
                const counts: Record<string, number> = {};
                let page = 1;
                let totalPages = 1;
                const LIMIT = 100;

                do {
                    const res = await fetch(`/api/leads?competitorSignal=true&limit=${LIMIT}&page=${page}`);
                    if (!res.ok) break;
                    const data = await res.json();
                    const leads: Array<{ competitorTech: string[] }> = data.leads ?? data.data ?? [];
                    for (const lead of leads) {
                        for (const tool of (lead.competitorTech ?? [])) {
                            const t = tool.trim().toLowerCase();
                            if (t) counts[t] = (counts[t] ?? 0) + 1;
                        }
                    }
                    totalPages = data.meta?.totalPages ?? (leads.length === LIMIT ? page + 1 : page);
                    page++;
                } while (page <= totalPages && page <= 50);

                setLeadCounts(counts);
                setTools(Object.keys(counts));
            } finally {
                setLoading(false);
            }
        }
        fetchLeadTools();
    }, []);

    return { tools, leadCounts, loading };
};

export default function CompetitorsPage() {
    const [groups, setGroups] = useState<ToolGroup[]>([]);
    const [insightsLoading, setInsightsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [refreshingTool, setRefreshingTool] = useState<string | null>(null);
    const [showAddModal, setShowAddModal] = useState(false);
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);

    const { tools: detectedTools, leadCounts, loading: leadsLoading } = useLeadTools();

    useEffect(() => {
        fetch("/api/campaigns?limit=100")
            .then((r) => r.ok ? r.json() : { campaigns: [] })
            .then((d) => setCampaigns(d.campaigns ?? d.data ?? []))
            .catch(() => {});
    }, []);

    const loadInsights = useCallback(async (tools: string[]) => {
        const toolParam = tools.join(",");
        const url = `/api/competitor-insights?tools=${encodeURIComponent(toolParam)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to load insights");
        return (await res.json()) as CompetitorInsight[];
    }, []);

    useEffect(() => {
        if (leadsLoading) return;
        if (detectedTools.length === 0) {
            setInsightsLoading(false);
            return;
        }

        async function fetchInsights() {
            setInsightsLoading(true);
            try {
                const insights = await loadInsights(detectedTools);
                setGroups(
                    detectedTools.map((tool) => ({
                        tool,
                        insights: insights.filter((i) => i.tool === tool),
                        leadCount: leadCounts[tool] ?? 0,
                    })),
                );
            } catch (e) {
                setError(e instanceof Error ? e.message : "Unknown error");
            } finally {
                setInsightsLoading(false);
            }
        }
        fetchInsights();
    }, [detectedTools, leadsLoading, leadCounts, loadInsights]);

    const loading = leadsLoading || insightsLoading;

    const handleAnswer = useCallback(async (id: string, fixes: boolean | null, note?: string) => {
        const res = await fetch("/api/competitor-insights", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, userFixesIt: fixes, userNote: note }),
        });
        if (!res.ok) return;
        const updated = await res.json() as CompetitorInsight;
        setGroups((prev) =>
            prev.map((g) => ({
                ...g,
                insights: g.insights.map((i) => (i.id === updated.id ? updated : i)),
            })),
        );
    }, []);

    const handleRefresh = useCallback(async (tool: string) => {
        setRefreshingTool(tool);
        try {
            const res = await fetch(`/api/competitor-insights?tools=${encodeURIComponent(tool)}&refresh=1`);
            if (!res.ok) return;
            const freshInsights = (await res.json()) as CompetitorInsight[];
            setGroups((prev) =>
                prev.map((g) =>
                    g.tool === tool
                        ? { ...g, insights: freshInsights.filter((i) => i.tool === tool) }
                        : g,
                ),
            );
        } finally {
            setRefreshingTool(null);
        }
    }, []);

    const totalConfirmed = groups.reduce((n, g) => n + g.insights.filter((i) => i.userFixesIt === true).length, 0);
    const totalInsights = groups.reduce((n, g) => n + g.insights.length, 0);
    const totalLeads = Object.values(leadCounts).reduce((n, v) => n + v, 0);

    const handleAddCompetitor = useCallback(async (tool: string, campaignId?: string) => {
        const res = await fetch(`/api/competitor-insights?tools=${encodeURIComponent(tool)}&refresh=1`);
        if (!res.ok) throw new Error("Failed to fetch insights");
        const freshInsights = (await res.json()) as CompetitorInsight[];
        const toolInsights = freshInsights.filter((i) => i.tool === tool);

        setGroups((prev) => {
            const exists = prev.find((g) => g.tool === tool);
            if (exists) {
                return prev.map((g) => g.tool === tool ? { ...g, insights: toolInsights } : g);
            }
            return [...prev, { tool, insights: toolInsights, leadCount: 0 }];
        });

        if (campaignId) {
            await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/competitor-tag`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tool }),
            }).catch(() => {});
        }
    }, []);

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {showAddModal && (
                <AddCompetitorModal
                    campaigns={campaigns}
                    onAdd={handleAddCompetitor}
                    onClose={() => setShowAddModal(false)}
                />
            )}
            <div className="flex-shrink-0 px-6 py-5 border-b border-[var(--border)] bg-[var(--surface)]">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h1 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--red-text)]" aria-hidden="true">
                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                            </svg>
                            Competitor Intelligence
                        </h1>
                        <p className="text-sm text-[var(--text-muted)] mt-0.5">
                            Market pain points your leads publicly complain about. Confirm which ones your product addresses — those answers personalize every displacement email.
                        </p>
                    </div>
                    <div className="flex items-center gap-4 flex-shrink-0">
                        <button
                            onClick={() => setShowAddModal(true)}
                            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-[var(--red)] text-white hover:bg-[var(--red-dim)] transition-colors"
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                            Add Competitor
                        </button>
                        <div className="w-px h-8 bg-[var(--border)]" />
                        <div className="text-right">
                            <p className="text-xl font-bold text-[var(--text-primary)] tabular-nums">{totalLeads}</p>
                            <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] font-medium">competitor leads</p>
                        </div>
                        <div className="w-px h-8 bg-[var(--border)]" />
                        <div className="text-right">
                            <p className="text-xl font-bold text-emerald-400 tabular-nums">{totalConfirmed}/{totalInsights}</p>
                            <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] font-medium">differentiators confirmed</p>
                        </div>
                        <div className="w-24 h-2 rounded-full bg-[var(--surface-2)] overflow-hidden">
                            <div
                                className="h-full rounded-full bg-emerald-500 transition-all duration-700"
                                style={{ width: totalInsights > 0 ? `${(totalConfirmed / totalInsights) * 100}%` : "0%" }}
                            />
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
                {loading && (
                    <div className="flex flex-col items-center justify-center h-48 gap-3">
                        <svg className="animate-spin text-[var(--red)]" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                        </svg>
                        <p className="text-sm text-[var(--text-muted)]">Fetching market sentiments from Gemini…</p>
                    </div>
                )}

                {error && (
                    <div className="rounded-xl border border-[var(--red)]/30 bg-[var(--red-glow)] px-5 py-4 text-sm text-[var(--red-text)]">
                        {error}
                    </div>
                )}

                {!loading && !error && (
                    <>
                        {totalLeads > 0 && (
                            <div className="mb-5 rounded-xl border border-amber-500/20 bg-amber-500/5 px-5 py-3 flex items-center gap-3">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400 flex-shrink-0" aria-hidden="true">
                                    <circle cx="12" cy="12" r="10" />
                                    <line x1="12" y1="8" x2="12" y2="12" />
                                    <line x1="12" y1="16" x2="12.01" y2="16" />
                                </svg>
                                <p className="text-sm text-amber-300">
                                    <span className="font-semibold">{totalLeads} leads</span> in your campaigns use competitor tools. Confirm your differentiators below to unlock personalised displacement emails for all of them.
                                </p>
                            </div>
                        )}

                        <div className="space-y-4">
                            {groups
                                .sort((a, b) => b.leadCount - a.leadCount)
                                .map((group) => (
                                    <ToolCard
                                        key={group.tool}
                                        group={group}
                                        onAnswer={handleAnswer}
                                        onRefresh={handleRefresh}
                                        refreshing={refreshingTool === group.tool}
                                    />
                                ))}
                        </div>

                        {groups.length === 0 && (
                            <div className="flex flex-col items-center justify-center h-48 gap-2 text-center">
                                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--text-muted)]" aria-hidden="true">
                                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                                </svg>
                                <p className="text-sm font-medium text-[var(--text-secondary)]">No competitor data yet</p>
                                <p className="text-xs text-[var(--text-muted)]">Run a campaign with competitor tech detection to populate this page.</p>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
