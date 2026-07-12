"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { TopBar } from "@/app/components/dashboard/TopBar";
import { fetchResearchReport, openResearchStream, ResearchReport, triggerResearch } from "@/app/api/research/research.api";



interface Signal {
    id: string;
    type: string;
    value: string;
    confidence: number;
}

interface BreakdownScores {
    icpMatch: number;
    intentStrength: number;
    fundingSignals: number;
    hiringVelocity: number;
    techFit: number;
    recency: number;
}

interface Lead {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    title: string | null;
    companyName: string;
    website: string | null;
    linkedinUrl: string | null;
    qualificationScore: number | null;
    qualificationReason: string | null;
    recommendedAction: "HIGH_PRIORITY" | "STANDARD" | "NURTURE" | "DISQUALIFY" | null;
    pipelineStage: "PROSPECT" | "QUALIFIED" | "OUTREACH" | "DISQUALIFIED" | null;
    emailStatus: "VERIFIED" | "DELIVERED" | "BOUNCED" | "NOT_ATTEMPTED" | null;
    emailVerified: boolean;
    evidenceTriggers: string[] | null;
    breakdownScores: BreakdownScores | null;
    enrichmentData: Record<string, unknown> | null;
    signals: Signal[];
    competitorSignal: boolean;
    competitorTech: string[] | null;
    createdAt: string;
    campaign: { id: string; name: string; status: string };
}

interface CommitteeMember {
    id: string;
    firstName: string | null;
    lastName: string | null;
    title: string | null;
    email: string | null;
    emailVerified: boolean;
    qualificationScore: number | null;
    recommendedAction: string | null;
    pipelineStage: string | null;
    linkedinUrl: string | null;
    campaign: { id: string; name: string };
}

interface Campaign {
    id: string;
    name: string;
    status: string;
}

interface PaginationMeta {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

type DrawerTab = "profile" | "signals" | "enrichment" | "research";

const SIGNAL_TYPES = [
    { key: "FUNDING_SIGNAL", label: "Funding", icon: "💰" },
    { key: "HIRING_SIGNAL", label: "Hiring", icon: "🧑‍💼" },
    { key: "GROWTH_SIGNAL", label: "Growth", icon: "📈" },
    { key: "TECH_SIGNAL", label: "Tech", icon: "⚙️" },
    { key: "INTENT_SIGNAL", label: "Intent", icon: "🎯" },
    { key: "COMMUNITY_INTENT", label: "Community", icon: "💬" },
];

const ACTION_CFG: Record<string, { label: string; color: string; bg: string }> = {
    HIGH_PRIORITY: { label: "High Priority", color: "var(--red)", bg: "var(--red-glow, rgba(229,72,72,0.1))" },
    STANDARD: { label: "Standard", color: "#38bdf8", bg: "rgba(56,189,248,0.1)" },
    NURTURE: { label: "Nurture", color: "#a78bfa", bg: "rgba(167,139,250,0.1)" },
    DISQUALIFY: { label: "Disqualify", color: "var(--text-muted)", bg: "var(--surface-2)" },
};

const SCORE_COLOR = (s: number) =>
    s >= 0.75 ? "#1D9E75" : s >= 0.5 ? "#EF9F27" : "var(--red)";

function authFetch(url: string, init?: RequestInit): Promise<Response> {
    return fetch(url, { ...init, credentials: "include" });
}

function scoreBar(score: number, color: string) {
    return (
        <div className="flex items-center gap-2 min-w-0">
            <div
                className="h-1.5 rounded-full flex-shrink-0"
                style={{ width: 48, background: "var(--surface-2)" }}
            >
                <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.round(score * 100)}%`, background: color }}
                />
            </div>
            <span className="text-xs tabular-nums" style={{ color }}>
                {Math.round(score * 100)}
            </span>
        </div>
    );
}

function Skeleton({ w, h }: { w?: number | string; h?: number }) {
    return (
        <div
            className="rounded animate-pulse"
            style={{ width: w ?? "100%", height: h ?? 14, background: "var(--surface-2)" }}
        />
    );
}

function SignalBadge({ type }: { type: string }) {
    const cfg = SIGNAL_TYPES.find(s => s.key === type);
    if (!cfg) return null;
    return (
        <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
            style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
        >
            <span aria-hidden="true">{cfg.icon}</span>
            {cfg.label}
        </span>
    );
}

interface Filters {
    campaignId: string;
    signals: string[];
    minScore: number;
    action: string;
    competitorOnly: boolean;
}

function FilterSidebar({
    campaigns,
    filters,
    onChange,
}: {
    campaigns: Campaign[];
    filters: Filters;
    onChange: (f: Filters) => void;
}) {
    function toggle(key: keyof Filters, value: unknown) {
        if (key === "signals") {
            const cur = filters.signals;
            const next = cur.includes(value as string)
                ? cur.filter(s => s !== value)
                : [...cur, value as string];
            onChange({ ...filters, signals: next });
        } else {
            onChange({ ...filters, [key]: value });
        }
    }

    return (
        <aside
            className="flex-shrink-0 w-52 flex flex-col gap-5 pt-1"
            aria-label="Research filters"
        >
            <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest mb-2"
                    style={{ color: "var(--text-muted)" }}>
                    Campaign
                </p>
                <select
                    value={filters.campaignId}
                    onChange={e => toggle("campaignId", e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg text-xs outline-none"
                    style={{
                        background: "var(--navy-mid)",
                        border: "1px solid var(--border)",
                        color: "var(--text-primary)",
                    }}
                >
                    <option value="">All campaigns</option>
                    {campaigns.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                </select>
            </div>

            <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest mb-2"
                    style={{ color: "var(--text-muted)" }}>
                    Buying signals
                </p>
                <div className="space-y-2">
                    {SIGNAL_TYPES.map(s => (
                        <label key={s.key} className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={filters.signals.includes(s.key)}
                                onChange={() => toggle("signals", s.key)}
                                className="rounded"
                                style={{ accentColor: "var(--red)" }}
                            />
                            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                                {s.icon} {s.label}
                            </span>
                        </label>
                    ))}
                </div>
            </div>

            <div>
                <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-semibold uppercase tracking-widest"
                        style={{ color: "var(--text-muted)" }}>
                        Min score
                    </p>
                    <span className="text-xs font-medium tabular-nums"
                        style={{ color: "var(--text-primary)" }}>
                        {filters.minScore}
                    </span>
                </div>
                <input
                    type="range"
                    min={0}
                    max={100}
                    value={filters.minScore}
                    onChange={e => toggle("minScore", Number(e.target.value))}
                    className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                    style={{ accentColor: "var(--red)" }}
                />
                <div className="flex justify-between mt-1">
                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>0</span>
                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>100</span>
                </div>
            </div>

            <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest mb-2"
                    style={{ color: "var(--text-muted)" }}>
                    Priority
                </p>
                <div className="space-y-1.5">
                    {[["", "All"], ...Object.entries(ACTION_CFG).map(([k, v]) => [k, v.label])].map(([k, label]) => (
                        <button
                            key={k}
                            onClick={() => toggle("action", k)}
                            className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors"
                            style={{
                                background: filters.action === k ? "var(--surface-2)" : "transparent",
                                color: filters.action === k ? "var(--text-primary)" : "var(--text-muted)",
                                border: filters.action === k ? "1px solid var(--border)" : "1px solid transparent",
                            }}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            <div>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                        type="checkbox"
                        checked={filters.competitorOnly}
                        onChange={e => toggle("competitorOnly", e.target.checked)}
                        style={{ accentColor: "var(--red)" }}
                    />
                    <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                        Competitor signals only
                    </span>
                </label>
            </div>

            <button
                onClick={() => onChange({
                    campaignId: "",
                    signals: [],
                    minScore: 0,
                    action: "",
                    competitorOnly: false,
                })}
                className="text-xs text-left transition-colors"
                style={{ color: "var(--text-muted)" }}
            >
                Clear all filters
            </button>
        </aside>
    );
}

function DrawerProfileTab({ lead }: { lead: Lead }) {
    const enrichment = (lead.enrichmentData ?? {}) as Record<string, any>;
    const company = (enrichment.company ?? {}) as Record<string, any>;
    const person = (enrichment.person ?? {}) as Record<string, any>;

    const rows: { label: string; value: string | undefined }[] = [
        { label: "Title", value: lead.title ?? person.title ?? undefined },
        { label: "Email", value: lead.email ?? person.email ?? undefined },
        { label: "LinkedIn", value: lead.linkedinUrl ?? person.linkedinUrl ?? undefined },
        { label: "Industry", value: company.industry ?? undefined },
        { label: "Headcount", value: company.employeeCount ? String(company.employeeCount) : undefined },
        {
            label: "Funding",
            value: company.fundingTotalUsd
                ? `$${(company.fundingTotalUsd / 1_000_000).toFixed(1)}M total`
                : undefined,
        },
        { label: "Founded", value: company.foundedYear ? String(company.foundedYear) : undefined },
        { label: "Country", value: company.country ?? undefined },
    ].filter(r => r.value);

    return (
        <div className="space-y-5">
            {lead.qualificationReason && (
                <div
                    className="p-3 rounded-lg text-xs leading-relaxed"
                    style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
                >
                    {lead.qualificationReason}
                </div>
            )}

            {rows.length > 0 && (
                <div
                    className="rounded-xl overflow-hidden"
                    style={{ border: "1px solid var(--border)" }}
                >
                    <table className="w-full text-xs">
                        <tbody>
                            {rows.map((r, i) => {
                                const isLinkedIn = r.label === "LinkedIn";
                                return (
                                    <tr
                                        key={r.label}
                                        style={{ borderBottom: i < rows.length - 1 ? "1px solid var(--border)" : undefined }}
                                    >
                                        <td className="px-3 py-2 w-24" style={{ color: "var(--text-muted)" }}>
                                            {r.label}
                                        </td>
                                        <td className="px-3 py-2 font-medium break-all" style={{ color: "var(--text-primary)" }}>
                                            {isLinkedIn ? (
                                                <a
                                                    href={r.value}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="underline underline-offset-2"
                                                    style={{ color: "var(--text-primary)" }}
                                                >
                                                    View profile
                                                </a>
                                            ) : (
                                                r.value
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {lead.breakdownScores && (
                <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest mb-2"
                        style={{ color: "var(--text-muted)" }}>
                        Score breakdown
                    </p>
                    <div className="space-y-2">
                        {Object.entries(lead.breakdownScores).map(([k, v]) => {
                            const label = k.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase());
                            const val = v as number;
                            return (
                                <div key={k} className="flex items-center justify-between gap-3">
                                    <span className="text-xs w-32 truncate" style={{ color: "var(--text-muted)" }}>
                                        {label}
                                    </span>
                                    {scoreBar(val, SCORE_COLOR(val))}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {(lead.evidenceTriggers?.length ?? 0) > 0 && (
                <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest mb-2"
                        style={{ color: "var(--text-muted)" }}>
                        Evidence triggers
                    </p>
                    <ul className="space-y-1.5">
                        {(lead.evidenceTriggers ?? []).map((t, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs"
                                style={{ color: "var(--text-secondary)" }}>
                                <span className="mt-0.5 flex-shrink-0" style={{ color: "#1D9E75" }}>✓</span>
                                {t}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {(lead.competitorTech?.length ?? 0) > 0 && (
                <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest mb-2"
                        style={{ color: "var(--text-muted)" }}>
                        Competitor tech
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                        {(lead.competitorTech ?? []).map(t => (
                            <span
                                key={t}
                                className="px-2 py-0.5 rounded text-xs"
                                style={{
                                    background: "var(--red-glow, rgba(229,72,72,0.1))",
                                    color: "var(--red)",
                                    border: "1px solid rgba(229,72,72,0.2)",
                                }}
                            >
                                {t}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function DrawerSignalsTab({ lead }: { lead: Lead }) {
    if ((lead.signals?.length ?? 0) === 0) {
        return (
            <p className="text-xs text-center py-8" style={{ color: "var(--text-muted)" }}>
                No signals detected for this lead yet.
            </p>
        );
    }

    const grouped = (lead.signals ?? []).reduce<Record<string, Signal[]>>((acc, s) => {
        (acc[s.type] ??= []).push(s);
        return acc;
    }, {});

    return (
        <div className="space-y-5">
            {Object.entries(grouped).map(([type, sigs]) => {
                const cfg = SIGNAL_TYPES.find(s => s.key === type);
                return (
                    <div key={type}>
                        <p className="text-[10px] font-semibold uppercase tracking-widest mb-2 flex items-center gap-1.5"
                            style={{ color: "var(--text-muted)" }}>
                            <span aria-hidden="true">{cfg?.icon}</span>
                            {cfg?.label ?? type}
                        </p>
                        <div className="space-y-2">
                            {sigs.map(s => (
                                <div
                                    key={s.id}
                                    className="p-3 rounded-lg"
                                    style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
                                >
                                    <div className="flex items-start justify-between gap-2 mb-1">
                                        <p className="text-xs" style={{ color: "var(--text-primary)" }}>
                                            {s.value}
                                        </p>
                                        <span
                                            className="text-[10px] tabular-nums flex-shrink-0"
                                            style={{ color: SCORE_COLOR(s.confidence) }}
                                        >
                                            {Math.round(s.confidence * 100)}%
                                        </span>
                                    </div>
                                    <div
                                        className="h-1 rounded-full mt-1.5"
                                        style={{ background: "var(--navy-mid)" }}
                                    >
                                        <div
                                            className="h-full rounded-full"
                                            style={{
                                                width: `${Math.round(s.confidence * 100)}%`,
                                                background: SCORE_COLOR(s.confidence),
                                            }}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function DrawerEnrichmentTab({ lead }: { lead: Lead }) {
    const enrichment = (lead.enrichmentData ?? {}) as Record<string, any>;
    const company = (enrichment.company ?? {}) as Record<string, any>;
    const providerMapCompany = (company.providerMap ?? {}) as Record<string, any>;
    const person = (enrichment.person ?? {}) as Record<string, any>;
    const providerMapPerson = (person.providerMap ?? {}) as Record<string, any>;

    const SOURCE_COLORS: Record<string, string> = {
        apollo: "rgba(56,189,248,0.15)",
        pdl: "rgba(167,139,250,0.15)",
        proxycurl: "rgba(251,191,36,0.15)",
        crunchbase: "rgba(29,158,117,0.15)",
        hunter: "rgba(251,146,60,0.15)",
        zerobounce: "rgba(34,211,238,0.15)",
    };

    const SOURCE_TEXT: Record<string, string> = {
        apollo: "#38bdf8",
        pdl: "#a78bfa",
        proxycurl: "#fbbf24",
        crunchbase: "#1D9E75",
        hunter: "#fb923c",
        zerobounce: "#22d3ee",
    };

    function Section({ title, fields, map }: {
        title: string;
        fields: Record<string, unknown>;
        map: Record<string, any>;
    }) {
        const entries = Object.entries(fields).filter(
            ([k, v]) => k !== "providerMap" && v != null && v !== ""
        );
        if (entries.length === 0) return null;
        return (
            <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest mb-2"
                    style={{ color: "var(--text-muted)" }}>
                    {title}
                </p>
                <div
                    className="rounded-xl overflow-hidden"
                    style={{ border: "1px solid var(--border)" }}
                >
                    <table className="w-full text-xs">
                        <tbody>
                            {entries.map(([k, v], i) => {
                                const src = map[k]?.source as string | undefined;
                                const label = k.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase());
                                return (
                                    <tr
                                        key={k}
                                        style={{ borderBottom: i < entries.length - 1 ? "1px solid var(--border)" : undefined }}
                                    >
                                        <td className="px-3 py-2 w-28" style={{ color: "var(--text-muted)" }}>
                                            {label}
                                        </td>
                                        <td className="px-3 py-2 font-medium" style={{ color: "var(--text-primary)" }}>
                                            {Array.isArray(v) ? v.join(", ") : String(v)}
                                        </td>
                                        {src && (
                                            <td className="px-3 py-2 text-right">
                                                <span
                                                    className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                                                    style={{
                                                        background: SOURCE_COLORS[src] ?? "var(--surface-2)",
                                                        color: SOURCE_TEXT[src] ?? "var(--text-muted)",
                                                    }}
                                                >
                                                    {src}
                                                </span>
                                            </td>
                                        )}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    const hasData = Object.keys(company).length > 0 || Object.keys(person).length > 0;

    if (!hasData) {
        return (
            <p className="text-xs text-center py-8" style={{ color: "var(--text-muted)" }}>
                No enrichment data yet. Run enrichment from the Leads page.
            </p>
        );
    }

    return (
        <div className="space-y-5">
            <Section title="Company" fields={company} map={providerMapCompany} />
            <Section title="Person" fields={person} map={providerMapPerson} />
        </div>
    );
}

function DrawerResearchTab({ lead }: { lead: Lead }) {
    const [report, setReport] = useState<ResearchReport | null>(null);
    const [streaming, setStreaming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [initialLoading, setInitialLoading] = useState(true);
    const [elapsedMs, setElapsedMs] = useState(0);
    const cleanupRef = useRef<(() => void) | null>(null);
    const startedAtRef = useRef<number | null>(null);
    const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const STALL_WARNING_MS = 15_000;
    const MAX_WAIT_MS = 150_000;

    function stopStreaming() {
        cleanupRef.current?.();
        cleanupRef.current = null;
        if (tickRef.current) {
            clearInterval(tickRef.current);
            tickRef.current = null;
        }
        startedAtRef.current = null;
        setStreaming(false);
    }

    function cancelGeneration() {
        stopStreaming();
        setError("Research canceled.");
    }

    useEffect(() => {
        let cancelled = false;
        fetchResearchReport(lead.id)
            .then(r => {
                if (!cancelled) setReport(r);
            })
            .finally(() => {
                if (!cancelled) setInitialLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [lead.id]);

    useEffect(() => {
        return () => {
            cleanupRef.current?.();
            cleanupRef.current = null;
            if (tickRef.current) {
                clearInterval(tickRef.current);
                tickRef.current = null;
            }
        };
    }, [lead.id]);

    async function generate() {
        setError(null);
        setElapsedMs(0);
        setStreaming(true);
        startedAtRef.current = Date.now();

        tickRef.current = setInterval(() => {
            if (!startedAtRef.current) return;
            const elapsed = Date.now() - startedAtRef.current;
            setElapsedMs(elapsed);
            if (elapsed >= MAX_WAIT_MS) {
                stopStreaming();
                setError("Research is taking longer than expected, likely due to an external API rate limit. Please try again in a minute.");
            }
        }, 1000);

        try {
            const { reportId } = await triggerResearch(lead.id);
            setReport({
                id: reportId,
                leadId: lead.id,
                status: "RUNNING",
                errorMessage: null,
                companySnapshot: null,
                competitiveContext: null,
                icpAlignment: null,
                outreachAngle: null,
                newSignalsFound: [],
                startedAt: new Date().toISOString(),
                completedAt: null,
                expiresAt: null,
            });

            cleanupRef.current = openResearchStream(lead.id, (event) => {
                startedAtRef.current = Date.now();
                setElapsedMs(0);

                switch (event.type) {
                    case "status":
                        setReport(prev => (prev ? { ...prev, status: event.data.status } : prev));
                        break;
                    case "section":
                        setReport(prev => {
                            if (!prev) return null;
                            const payload = event.data.payload;
                            if (payload && typeof payload === "object" && "chunk" in payload) {
                                return prev;
                            }
                            return { ...prev, [event.data.section]: payload } as ResearchReport;
                        });
                        break;
                    case "signal":
                        setReport(prev =>
                            prev
                                ? { ...prev, newSignalsFound: [...(prev.newSignalsFound ?? []), event.data.value] }
                                : prev
                        );
                        break;
                    case "section_failed":
                        console.warn(`Research section "${event.data.section}" failed:`, event.data.message);
                        break;
                    case "complete":
                        stopStreaming();
                        fetchResearchReport(lead.id).then(r => {
                            if (r) setReport(r);
                        });
                        break;
                    case "error":
                        stopStreaming();
                        setError(event.data.message);
                        break;
                }
            });
        } catch (err) {
            stopStreaming();
            setError(err instanceof Error ? err.message : "Failed to start research");
        }
    }

    if (initialLoading) {
        return (
            <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} h={60} />)}
            </div>
        );
    }

    const hasAnyContent =
        report &&
        (report.companySnapshot ||
            report.competitiveContext ||
            report.icpAlignment ||
            report.outreachAngle ||
            (report.newSignalsFound ?? []).length > 0);

    if (!hasAnyContent) {
        return (
            <div className="flex flex-col items-center justify-center py-10 gap-4 text-center">
                <div className="w-10 h-10 rounded-full flex items-center justify-center"
                    style={{ background: "var(--surface-2)" }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="1.5"
                        strokeLinecap="round" strokeLinejoin="round"
                        style={{ color: "var(--text-muted)" }} aria-hidden="true">
                        <path d="M9.663 17h4.673M12 3v1m6.364 1.636-.707.707M21 12h-1M4 12H3m3.343-5.657-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                </div>
                <div>
                    <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                        AI research card
                    </p>
                    <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                        Generates a company snapshot, competitive context, and a personalized outreach angle.
                    </p>
                </div>
                {error && (
                    <div className="text-xs px-3 py-2.5 rounded-lg border border-[rgba(229,72,72,0.2)] text-left w-full max-h-40 overflow-y-auto"
                        style={{ color: "var(--red)", background: "var(--red-glow, rgba(229,72,72,0.1))" }}>
                        <p className="font-semibold mb-1">Research Error</p>
                        <p className="opacity-95 whitespace-pre-wrap break-all leading-normal font-mono text-[10px]">
                            {error}
                        </p>
                    </div>
                )}
                <button
                    onClick={generate}
                    disabled={streaming}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                    style={{ background: "var(--red)", color: "#fff" }}
                >
                    {streaming ? (
                        <>
                            <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none"
                                stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" />
                            </svg>
                            Researching…
                        </>
                    ) : (
                        "Generate research card"
                    )}
                </button>
            </div>
        );
    }

    const snap = report?.companySnapshot;
    const comp = report?.competitiveContext;
    const icp = report?.icpAlignment;
    const angle = report?.outreachAngle;

    return (
        <div className="space-y-5">
            {streaming && (
                <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg"
                    style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
                    <svg className="w-3 h-3 animate-spin flex-shrink-0" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" />
                    </svg>
                    Research in progress — sections fill in as they complete…
                </div>
            )}

            {error && (
                <div className="text-xs px-3 py-2.5 rounded-lg border border-[rgba(229,72,72,0.2)] text-left w-full max-h-40 overflow-y-auto"
                    style={{ color: "var(--red)", background: "var(--red-glow, rgba(229,72,72,0.1))" }}>
                    <p className="font-semibold mb-1">Research Error</p>
                    <p className="opacity-95 whitespace-pre-wrap break-all leading-normal font-mono text-[10px]">
                        {error}
                    </p>
                </div>
            )}

            {snap && (
                <div className="space-y-3">
                    <p className="text-[10px] font-semibold uppercase tracking-widest"
                        style={{ color: "var(--text-muted)" }}>
                        Company snapshot
                    </p>
                    <div className="p-3.5 rounded-xl text-xs leading-relaxed space-y-1.5"
                        style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
                        <p>
                            <span className="font-medium" style={{ color: "var(--text-muted)" }}>Value prop: </span>
                            {snap.valueProposition}
                        </p>
                        <p>
                            <span className="font-medium" style={{ color: "var(--text-muted)" }}>Target customer: </span>
                            {snap.targetCustomer}
                        </p>
                        {snap.techStack.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 pt-1">
                                {snap.techStack.map(t => (
                                    <span key={t} className="px-1.5 py-0.5 rounded text-[10px]"
                                        style={{ background: "var(--navy-mid)", color: "var(--text-secondary)" }}>
                                        {t}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    {snap.fundingEvents.length > 0 && (
                        <ul className="space-y-1.5">
                            {snap.fundingEvents.map((f, i) => (
                                <li key={i} className="text-xs px-3 py-2 rounded-lg"
                                    style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
                                    💰 {f.description}{f.amount ? ` — ${f.amount}` : ""}{f.date ? ` (${f.date})` : ""}
                                </li>
                            ))}
                        </ul>
                    )}

                    {snap.hiringSignals.length > 0 && (
                        <ul className="space-y-1.5">
                            {snap.hiringSignals.map((h, i) => (
                                <li key={i} className="text-xs px-3 py-2 rounded-lg flex items-start justify-between gap-2"
                                    style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
                                    <span>🧑‍💼 {h.role} — {h.signalValue}</span>
                                    <span className="tabular-nums flex-shrink-0" style={{ color: SCORE_COLOR(h.confidence) }}>
                                        {Math.round(h.confidence * 100)}%
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}

                    {snap.recentNews.length > 0 && (
                        <ul className="space-y-1.5">
                            {snap.recentNews.map((n, i) => (
                                <li key={i} className="text-xs px-3 py-2 rounded-lg"
                                    style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
                                    <a href={n.url} target="_blank" rel="noreferrer"
                                        className="underline underline-offset-2 font-medium"
                                        style={{ color: "var(--text-primary)" }}>
                                        {n.headline}
                                    </a>
                                    <p className="mt-1" style={{ color: "var(--text-muted)" }}>{n.relevanceReason}</p>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {comp && (
                <div className="space-y-2">
                    <p className="text-[10px] font-semibold uppercase tracking-widest"
                        style={{ color: "var(--text-muted)" }}>
                        Competitive context
                    </p>
                    <div className="p-3.5 rounded-xl text-xs leading-relaxed space-y-1.5"
                        style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
                        {comp.competitorSignalDetected && comp.competitorProducts.length > 0 && (
                            <p>
                                <span className="font-medium" style={{ color: "var(--text-muted)" }}>Using: </span>
                                {comp.competitorProducts.join(", ")}
                            </p>
                        )}
                        {comp.displacementAngle && (
                            <p>
                                <span className="font-medium" style={{ color: "var(--text-muted)" }}>Displacement angle: </span>
                                {comp.displacementAngle}
                            </p>
                        )}
                        {comp.complementaryAngle && (
                            <p>
                                <span className="font-medium" style={{ color: "var(--text-muted)" }}>Complementary angle: </span>
                                {comp.complementaryAngle}
                            </p>
                        )}
                        {comp.winRateForSignalType != null && (
                            <p>
                                <span className="font-medium" style={{ color: "var(--text-muted)" }}>Historical win rate for this signal: </span>
                                {Math.round(comp.winRateForSignalType * 100)}%
                            </p>
                        )}
                    </div>
                </div>
            )}

            {icp && (
                <div className="space-y-2">
                    <p className="text-[10px] font-semibold uppercase tracking-widest"
                        style={{ color: "var(--text-muted)" }}>
                        ICP alignment
                    </p>
                    <div className="space-y-2">
                        {Object.entries(icp.breakdown).map(([k, v]) => {
                            const label = k.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase());
                            return (
                                <div key={k} className="flex items-center justify-between gap-3">
                                    <span className="text-xs w-32 truncate" style={{ color: "var(--text-muted)" }}>{label}</span>
                                    {scoreBar(v, SCORE_COLOR(v))}
                                </div>
                            );
                        })}
                    </div>
                    <p className="text-xs pt-1" style={{ color: "var(--text-secondary)" }}>{icp.fitNarrative}</p>
                    {icp.gapNarrative && (
                        <p className="text-xs" style={{ color: "var(--text-muted)" }}>{icp.gapNarrative}</p>
                    )}
                </div>
            )}

            {angle && !("chunk" in angle) && (
                <div className="space-y-3">
                    <p className="text-[10px] font-semibold uppercase tracking-widest"
                        style={{ color: "var(--text-muted)" }}>
                        Outreach angle
                    </p>
                    {(angle.primaryAngle || angle.angleRationale) && (
                        <div className="p-3.5 rounded-xl text-xs leading-relaxed"
                            style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
                            {angle.primaryAngle && <p className="font-semibold mb-1" style={{ color: "var(--text-primary)" }}>{angle.primaryAngle}</p>}
                            {angle.angleRationale && <p>{angle.angleRationale}</p>}
                        </div>
                    )}

                    {Array.isArray(angle.talkTracks) && angle.talkTracks.map((t, i) => (
                        <div key={i} className="p-3 rounded-xl space-y-1 text-xs"
                            style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                            {t?.trigger && (
                                <p>
                                    <span className="font-medium" style={{ color: "var(--text-muted)" }}>Trigger: </span>
                                    {t.trigger}
                                </p>
                            )}
                            {t?.hook && (
                                <p>
                                    <span className="font-medium" style={{ color: "var(--text-muted)" }}>Hook: </span>
                                    {t.hook}
                                </p>
                            )}
                            {t?.value && (
                                <p>
                                    <span className="font-medium" style={{ color: "var(--text-muted)" }}>Value: </span>
                                    {t.value}
                                </p>
                            )}
                            {t?.cta && (
                                <p>
                                    <span className="font-medium" style={{ color: "var(--text-muted)" }}>CTA: </span>
                                    {t.cta}
                                </p>
                            )}
                        </div>
                    ))}

                    {angle.openingLineSuggestion && (
                        <div className="p-3.5 rounded-xl space-y-2"
                            style={{ background: "rgba(29,158,117,0.06)", border: "1px solid rgba(29,158,117,0.2)" }}>
                            <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#1D9E75" }}>
                                Suggested opening line
                            </p>
                            <p className="text-xs italic" style={{ color: "var(--text-secondary)" }}>
                                "{angle.openingLineSuggestion}"
                            </p>
                        </div>
                    )}

                    {Array.isArray(angle.warningsAndAvoid) && angle.warningsAndAvoid.length > 0 && (
                        <ul className="space-y-1">
                            {angle.warningsAndAvoid.map((w, i) => (
                                <li key={i} className="text-xs" style={{ color: "var(--red)" }}>⚠ {w}</li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {(report?.newSignalsFound ?? []).length > 0 && (
                <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest mb-2"
                        style={{ color: "var(--text-muted)" }}>
                        New signals found
                    </p>
                    <ul className="space-y-1">
                        {(report?.newSignalsFound ?? []).map((s, i) => (
                            <li key={i} className="text-xs" style={{ color: "var(--text-secondary)" }}>✓ {s}</li>
                        ))}
                    </ul>
                </div>
            )}

            {!streaming && (
                <button onClick={generate} className="text-xs transition-colors" style={{ color: "var(--text-muted)" }}>
                    Regenerate
                </button>
            )}
        </div>
    );
}

function DrawerCommitteeTab({ lead }: { lead: Lead }) {
    const [members, setMembers] = useState<CommitteeMember[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        authFetch(`/api/leads/${lead.id}/committee`)
            .then(r => r.json())
            .then(d => {
                if (!cancelled) setMembers(d.data ?? []);
            })
            .catch(() => {
                if (!cancelled) setMembers([]);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [lead.id]);

    if (loading) {
        return (
            <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} h={52} />)}
            </div>
        );
    }

    if (members.length === 0) {
        return (
            <p className="text-xs text-center py-8" style={{ color: "var(--text-muted)" }}>
                No other contacts found at {lead.companyName}.
            </p>
        );
    }

    return (
        <div className="space-y-2.5">
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {members.length} other contact{members.length !== 1 ? "s" : ""} at {lead.companyName}
            </p>
            {members.map(m => {
                const score = m.qualificationScore ?? 0;
                return (
                    <div
                        key={m.id}
                        className="p-3 rounded-xl"
                        style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
                    >
                        <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                                <p className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>
                                    {[m.firstName, m.lastName].filter(Boolean).join(" ") || "Unknown"}
                                </p>
                                <p className="text-[11px] truncate mt-0.5" style={{ color: "var(--text-muted)" }}>
                                    {m.title ?? "—"}
                                </p>
                                <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                                    {m.campaign.name}
                                </p>
                            </div>
                            {score > 0 && (
                                <span
                                    className="text-xs font-semibold tabular-nums flex-shrink-0 mt-0.5"
                                    style={{ color: SCORE_COLOR(score) }}
                                >
                                    {Math.round(score * 100)}
                                </span>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function LeadDrawer({
    lead,
    onClose,
}: {
    lead: Lead;
    onClose: () => void;
}) {
    const [tab, setTab] = useState<DrawerTab>("profile");

    const score = lead.qualificationScore ?? 0;
    const action = lead.recommendedAction;
    const actionCfg = action ? ACTION_CFG[action] : null;

    const TABS: { key: DrawerTab; label: string }[] = [
        { key: "profile", label: "Profile" },
        { key: "signals", label: `Signals (${lead.signals?.length ?? 0})` },
        { key: "enrichment", label: "Enrichment" },
        { key: "research", label: "AI Research" },
    ];

    const websiteHref = lead.website
        ? (lead.website.startsWith("http") ? lead.website : `https://${lead.website}`)
        : null;

    return (
        <div
            className="flex flex-col h-full"
            style={{
                borderLeft: "1px solid var(--border)",
                background: "var(--navy-mid)",
            }}
        >
            <div
                className="flex items-start justify-between px-5 py-4 flex-shrink-0"
                style={{ borderBottom: "1px solid var(--border)" }}
            >
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-sm font-semibold font-display"
                            style={{ color: "var(--text-primary)" }}>
                            {[lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.companyName}
                        </h2>
                        {actionCfg && (
                            <span
                                className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                                style={{ background: actionCfg.bg, color: actionCfg.color }}
                            >
                                {actionCfg.label}
                            </span>
                        )}
                    </div>
                    <p className="text-xs mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>
                        {lead.title ? `${lead.title} · ` : ""}{lead.companyName}
                    </p>
                    {score > 0 && (
                        <div className="mt-2">
                            {scoreBar(score, SCORE_COLOR(score))}
                        </div>
                    )}
                </div>
                <button
                    onClick={onClose}
                    aria-label="Close"
                    className="ml-3 w-7 h-7 flex items-center justify-center rounded-lg flex-shrink-0 transition-colors"
                    style={{ color: "var(--text-muted)" }}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2.5"
                        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                </button>
            </div>

            <div
                className="flex items-center gap-0 px-5 flex-shrink-0 overflow-x-auto"
                style={{ borderBottom: "1px solid var(--border)" }}
            >
                {TABS.map(t => (
                    <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        className="px-3 py-2.5 text-xs font-medium -mb-px border-b-2 transition-colors whitespace-nowrap"
                        style={{
                            color: tab === t.key ? "var(--text-primary)" : "var(--text-muted)",
                            borderBottomColor: tab === t.key ? "var(--red)" : "transparent",
                        }}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
                {tab === "profile" && <DrawerProfileTab lead={lead} />}
                {tab === "signals" && <DrawerSignalsTab lead={lead} />}
                {tab === "enrichment" && <DrawerEnrichmentTab lead={lead} />}
                {tab === "research" && <DrawerResearchTab lead={lead} />}
            </div>

            {websiteHref && (
                <div
                    className="px-5 py-4 flex-shrink-0 flex items-center gap-2"
                    style={{ borderTop: "1px solid var(--border)" }}
                >
                    <a
                        href={websiteHref}
                        target="_blank"
                        rel="noreferrer"
                        className="flex-1 px-3 py-2 rounded-lg text-xs font-medium text-center transition-colors"
                        style={{
                            background: "var(--surface-2)",
                            border: "1px solid var(--border)",
                            color: "var(--text-secondary)",
                        }}
                    >
                        Visit website
                    </a>
                    {lead.linkedinUrl && (
                        <a
                            href={lead.linkedinUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="px-3 py-2 rounded-lg text-xs font-medium transition-colors"
                            style={{
                                background: "var(--surface-2)",
                                border: "1px solid var(--border)",
                                color: "var(--text-secondary)",
                            }}
                        >
                            LinkedIn
                        </a>
                    )}
                </div>
            )}
        </div>
    );
}

function ResultsTable({
    leads,
    loading,
    activeLead,
    onSelect,
}: {
    leads: Lead[];
    loading: boolean;
    activeLead: Lead | null;
    onSelect: (lead: Lead) => void;
}) {
    if (loading) {
        return (
            <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                    <div
                        key={i}
                        className="px-4 py-3 rounded-xl flex items-center gap-4"
                        style={{ background: "var(--navy-mid)", border: "1px solid var(--border)" }}
                    >
                        <Skeleton w={180} />
                        <Skeleton w={120} />
                        <Skeleton w={60} />
                        <Skeleton w={80} />
                    </div>
                ))}
            </div>
        );
    }

    if (leads.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                    No leads match your filters.
                </p>
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                    Try adjusting the filters or run a new discovery.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-1.5">
            {leads.map(lead => {
                const score = lead.qualificationScore ?? 0;
                const action = lead.recommendedAction;
                const actionCfg = action ? ACTION_CFG[action] : null;
                const isActive = activeLead?.id === lead.id;
                const uniqueSignalTypes = [...new Set((lead.signals ?? []).map(s => s.type))].slice(0, 3);

                return (
                    <button
                        key={lead.id}
                        onClick={() => onSelect(lead)}
                        className="w-full text-left px-4 py-3 rounded-xl transition-colors"
                        style={{
                            background: isActive ? "var(--surface-2)" : "var(--navy-mid)",
                            border: `1px solid ${isActive ? "var(--red)" : "var(--border)"}`,
                        }}
                    >
                        <div className="flex items-center gap-4 min-w-0">
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 min-w-0">
                                    <span
                                        className="text-sm font-medium truncate"
                                        style={{ color: "var(--text-primary)" }}
                                    >
                                        {[lead.firstName, lead.lastName].filter(Boolean).join(" ") || "—"}
                                    </span>
                                    {lead.emailVerified && (
                                        <span
                                            className="flex-shrink-0 text-[10px] px-1 py-0.5 rounded"
                                            style={{ background: "rgba(29,158,117,0.12)", color: "#1D9E75" }}
                                        >
                                            ✓ verified
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>
                                    {lead.title ? `${lead.title} · ` : ""}{lead.companyName}
                                </p>
                            </div>

                            <div className="hidden md:flex items-center gap-1.5 flex-shrink-0">
                                {uniqueSignalTypes.map(t => <SignalBadge key={`${lead.id}-${t}`} type={t} />)}
                            </div>

                            <div className="flex-shrink-0 w-24">
                                {score > 0 && scoreBar(score, SCORE_COLOR(score))}
                            </div>

                            {actionCfg && (
                                <span
                                    className="flex-shrink-0 text-[10px] font-medium px-2 py-1 rounded-lg hidden sm:inline"
                                    style={{ background: actionCfg.bg, color: actionCfg.color }}
                                >
                                    {actionCfg.label}
                                </span>
                            )}

                            <svg
                                className="flex-shrink-0 w-3.5 h-3.5"
                                style={{ color: "var(--text-muted)" }}
                                viewBox="0 0 24 24" fill="none"
                                stroke="currentColor" strokeWidth="2"
                                strokeLinecap="round" strokeLinejoin="round"
                                aria-hidden="true"
                            >
                                <path d="m9 18 6-6-6-6" />
                            </svg>
                        </div>
                    </button>
                );
            })}
        </div>
    );
}

export default function ResearchPage() {
    const [leads, setLeads] = useState<Lead[]>([]);
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [meta, setMeta] = useState<PaginationMeta>({ total: 0, page: 1, limit: 20, totalPages: 1 });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeLead, setActiveLead] = useState<Lead | null>(null);
    const [page, setPage] = useState(1);

    const [query, setQuery] = useState("");
    const [debouncedQuery, setDebouncedQuery] = useState("");
    const [filters, setFilters] = useState<Filters>({
        campaignId: "",
        signals: [],
        minScore: 0,
        action: "",
        competitorOnly: false,
    });

    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        authFetch("/api/campaigns")
            .then(r => (r.ok ? r.json() : []))
            .then((data: unknown) => {
                const list = Array.isArray(data) ? (data as Campaign[]) : [];
                setCampaigns(list);
                if (list.length > 0 && !filters.campaignId) {
                    setFilters(f => ({ ...f, campaignId: list[0].id }));
                }
            })
            .catch(() => { });
    }, []);

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            setDebouncedQuery(query);
            setPage(1);
        }, 350);
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [query]);

    const loadLeads = useCallback(async () => {
        const cid = filters.campaignId || campaigns[0]?.id;
        if (!cid) {
            setLeads([]);
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(null);
        const p = new URLSearchParams({
            campaignId: cid,
            page: String(page),
            limit: "20",
            ...(debouncedQuery && { search: debouncedQuery }),
            ...(filters.action && { recommendedAction: filters.action }),
            ...(filters.minScore > 0 && { minScore: String(filters.minScore / 100) }),
            ...(filters.competitorOnly && { competitorSignal: "true" }),
            ...(filters.signals.length > 0 && { signalTypes: filters.signals.join(",") }),
        });
        try {
            const res = await authFetch(`/api/leads?${p}`);
            if (!res.ok) throw new Error(`${res.status}`);
            const data = await res.json();
            setLeads(data.data ?? []);
            setMeta(data.meta ?? { total: 0, page: 1, limit: 20, totalPages: 1 });
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load leads");
        } finally {
            setLoading(false);
        }
    }, [campaigns, filters, debouncedQuery, page]);

    useEffect(() => {
        loadLeads();
    }, [loadLeads]);

    const activeSignalCount =
        filters.signals.length +
        (filters.minScore > 0 ? 1 : 0) +
        (filters.action ? 1 : 0) +
        (filters.competitorOnly ? 1 : 0);

    const breadcrumbs = [
        { label: "Dashboard", href: "/dashboard" },
        { label: "Research", href: "/dashboard/research" },
    ];

    return (
        <div className="flex flex-col h-full min-h-0">
            <TopBar
                title="Research"
                subtitle="Prospect intelligence"
                breadcrumbs={breadcrumbs}
            />

            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <div
                    className="px-6 py-4 flex-shrink-0"
                    style={{ borderBottom: "1px solid var(--border)" }}
                >
                    <div className="relative max-w-2xl">
                        <svg
                            className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
                            style={{ color: "var(--text-muted)" }}
                            viewBox="0 0 24 24" fill="none"
                            stroke="currentColor" strokeWidth="2" aria-hidden="true"
                        >
                            <circle cx="11" cy="11" r="8" />
                            <path d="m21 21-4.35-4.35" />
                        </svg>
                        <input
                            type="search"
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Search leads by name, company, title…"
                            className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm outline-none"
                            style={{
                                background: "var(--navy-mid)",
                                border: "1px solid var(--border)",
                                color: "var(--text-primary)",
                            }}
                        />
                        {query && (
                            <button
                                onClick={() => setQuery("")}
                                className="absolute right-3 top-1/2 -translate-y-1/2"
                                style={{ color: "var(--text-muted)" }}
                                aria-label="Clear search"
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                    stroke="currentColor" strokeWidth="2.5"
                                    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        )}
                    </div>
                </div>

                <div className="flex-1 flex min-h-0 overflow-hidden">
                    <div
                        className="flex-shrink-0 w-52 overflow-y-auto px-5 py-5"
                        style={{ borderRight: "1px solid var(--border)" }}
                    >
                        <FilterSidebar
                            campaigns={campaigns}
                            filters={filters}
                            onChange={f => {
                                setFilters(f);
                                setPage(1);
                            }}
                        />
                    </div>

                    <div className="flex-1 flex min-w-0 overflow-hidden">
                        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                            <div
                                className="flex items-center justify-between px-5 py-3 flex-shrink-0"
                                style={{ borderBottom: "1px solid var(--border)" }}
                            >
                                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                                    {loading ? "Loading…" : `${meta.total.toLocaleString()} leads`}
                                    {activeSignalCount > 0 && (
                                        <span className="ml-2 px-1.5 py-0.5 rounded text-[10px]"
                                            style={{ background: "var(--red-glow, rgba(229,72,72,0.1))", color: "var(--red)" }}>
                                            {activeSignalCount} filter{activeSignalCount !== 1 ? "s" : ""} active
                                        </span>
                                    )}
                                </span>
                                {meta.totalPages > 1 && (
                                    <div className="flex items-center gap-2">
                                        <button
                                            disabled={page <= 1}
                                            onClick={() => setPage(p => p - 1)}
                                            className="px-2.5 py-1 rounded text-xs disabled:opacity-40"
                                            style={{
                                                background: "var(--navy-mid)",
                                                border: "1px solid var(--border)",
                                                color: "var(--text-primary)",
                                            }}
                                        >
                                            ‹
                                        </button>
                                        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                                            {page} / {meta.totalPages}
                                        </span>
                                        <button
                                            disabled={page >= meta.totalPages}
                                            onClick={() => setPage(p => p + 1)}
                                            className="px-2.5 py-1 rounded text-xs disabled:opacity-40"
                                            style={{
                                                background: "var(--navy-mid)",
                                                border: "1px solid var(--border)",
                                                color: "var(--text-primary)",
                                            }}
                                        >
                                            ›
                                        </button>
                                    </div>
                                )}
                            </div>

                            {error && (
                                <div className="mx-5 mt-3 px-4 py-3 rounded-lg text-xs"
                                    style={{
                                        background: "var(--red-glow, rgba(229,72,72,0.1))",
                                        color: "var(--red)",
                                        border: "1px solid rgba(229,72,72,0.2)",
                                    }}>
                                    {error}
                                </div>
                            )}

                            <div className="flex-1 overflow-y-auto px-5 py-4">
                                <ResultsTable
                                    leads={leads}
                                    loading={loading}
                                    activeLead={activeLead}
                                    onSelect={setActiveLead}
                                />
                            </div>
                        </div>

                        {activeLead && (
                            <div className="w-80 xl:w-96 flex-shrink-0 overflow-y-auto">
                                <LeadDrawer
                                    lead={activeLead}
                                    onClose={() => setActiveLead(null)}
                                />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}