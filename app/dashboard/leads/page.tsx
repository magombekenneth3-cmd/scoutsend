"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { CsvImportModal } from "@/app/components/CvsModal";
import { LeadResearchPanel } from "@/app/components/research/LeadResearchPanel";

/* ─── Types ─── */
interface Signal {
    id: string;
    type?: string;
    signalType?: string;
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
    evidenceTriggers: string[];
    breakdownScores: BreakdownScores | null;
    enrichmentData: Record<string, unknown> | null;
    signals: Signal[];
    _count: { outreachMessages: number; replies: number };
    campaign: { id: string; name: string; status: string };
    createdAt: string;
    competitorSignal: boolean;
    competitorTech: string[];
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

type SortField = "createdAt" | "qualificationScore" | "companyName";
type SortDir = "asc" | "desc";

/* ─── API helpers ─── */
function authHeaders(): Record<string, string> {
    const token = typeof window !== "undefined" ? localStorage.getItem("ss_token") : "";
    return {
        Authorization: `Bearer ${token ?? ""}`,
        "Content-Type": "application/json",
    };
}

async function apiFetch<T>(path: string): Promise<T> {
    const res = await fetch(`/api${path}`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

async function apiDelete(path: string): Promise<void> {
    const res = await fetch(`/api${path}`, { method: "DELETE", headers: authHeaders() });
    if (!res.ok) throw new Error(`API error ${res.status}`);
}

/* ─── Config maps ─── */
const ACTION_CFG = {
    HIGH_PRIORITY: {
        label: "High Priority",
        className: "bg-[var(--red-glow)] text-[var(--red)] border border-[var(--border-red)]",
        dot: "bg-[var(--red)]",
        icon: (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
        ),
    },
    STANDARD: {
        label: "Standard",
        className: "bg-sky-400/10 text-sky-400 border border-sky-400/20",
        dot: "bg-sky-400",
        icon: (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <circle cx="12" cy="12" r="4" />
            </svg>
        ),
    },
    NURTURE: {
        label: "Nurture",
        className: "bg-amber-400/10 text-amber-400 border border-amber-400/20",
        dot: "bg-amber-400",
        icon: (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
        ),
    },
    DISQUALIFY: {
        label: "Disqualify",
        className: "bg-[var(--surface-2)] text-[var(--text-muted)] border border-[var(--border)]",
        dot: "bg-[var(--text-muted)]",
        icon: (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
        ),
    },
};

const PIPELINE_CFG = {
    PROSPECT: { label: "Prospect", className: "bg-sky-400/10 text-sky-400 border border-sky-400/20" },
    QUALIFIED: { label: "Qualified", className: "bg-emerald-400/10 text-emerald-400 border border-emerald-400/20" },
    OUTREACH: { label: "Outreach", className: "bg-violet-400/10 text-violet-400 border border-violet-400/20" },
    DISQUALIFIED: { label: "Disqualified", className: "bg-[var(--surface-2)] text-[var(--text-muted)] border border-[var(--border)]" },
};

const SIGNAL_COLORS: Record<string, { bg: string; text: string }> = {
    HIRING: { bg: "bg-violet-400/10", text: "text-violet-400" },
    HIRING_SIGNAL: { bg: "bg-violet-400/10", text: "text-violet-400" },
    FUNDING: { bg: "bg-emerald-400/10", text: "text-emerald-400" },
    FUNDING_SIGNAL: { bg: "bg-emerald-400/10", text: "text-emerald-400" },
    EXPANSION: { bg: "bg-sky-400/10", text: "text-sky-400" },
    GROWTH_SIGNAL: { bg: "bg-sky-400/10", text: "text-sky-400" },
    INTENT_SIGNAL: { bg: "bg-sky-400/10", text: "text-sky-400" },
    TECH_SIGNAL: { bg: "bg-cyan-400/10", text: "text-cyan-400" },
    PRODUCT_LAUNCH: { bg: "bg-orange-400/10", text: "text-orange-400" },
    WEBSITE_COPY: { bg: "bg-amber-400/10", text: "text-amber-400" },
    CONTENT: { bg: "bg-[var(--surface-2)]", text: "text-[var(--text-secondary)]" },
};

const STATUS_DOT: Record<string, string> = {
    SENDING: "bg-emerald-400",
    REVIEW: "bg-amber-400",
    RESEARCHING: "bg-sky-400",
    GENERATING: "bg-violet-400",
    DRAFT: "bg-[var(--text-muted)]",
    PAUSED: "bg-[var(--text-muted)]",
    COMPLETED: "bg-emerald-400",
    FAILED: "bg-[var(--red)]",
};

/* ─── Small reusable components ─── */
function ScoreBar({ score }: { score: number }) {
    const displayScore = score <= 1 ? Math.round(score * 100) : Math.round(score);
    const color = displayScore >= 85 ? "bg-emerald-400" : displayScore >= 65 ? "bg-amber-400" : "bg-[var(--red)]";
    const textColor = displayScore >= 85 ? "text-emerald-400" : displayScore >= 65 ? "text-amber-400" : "text-[var(--red)]";
    return (
        <div className="flex items-center gap-2">
            <div className="w-14 h-1.5 bg-[var(--surface-2)] rounded-full overflow-hidden flex-shrink-0">
                <div
                    className={`h-full rounded-full ${color} transition-all duration-500`}
                    style={{ width: `${displayScore}%` }}
                    role="progressbar"
                    aria-valuenow={displayScore}
                    aria-valuemax={100}
                    aria-label="Qualification score"
                />
            </div>
            <span className={`text-xs font-semibold tabular-nums ${textColor}`}>{displayScore}</span>
        </div>
    );
}

function SignalTag({ type, signalType }: { type?: string; signalType?: string }) {
    const rawType = signalType ?? type ?? "UNKNOWN_SIGNAL";
    const cfg = SIGNAL_COLORS[rawType] ?? SIGNAL_COLORS.CONTENT;
    return (
        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>
            <span className="w-1 h-1 rounded-full bg-current opacity-70 flex-shrink-0" aria-hidden="true" />
            {rawType.replace(/_SIGNAL$/, "").replace(/_/g, " ")}
        </span>
    );
}

function ActionBadge({ action }: { action: keyof typeof ACTION_CFG | null }) {
    if (!action || !ACTION_CFG[action]) return null;
    const cfg = ACTION_CFG[action];
    return (
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${cfg.className}`}>
            {cfg.icon}
            {cfg.label}
        </span>
    );
}

function PipelinePill({ stage }: { stage: keyof typeof PIPELINE_CFG | null }) {
    if (!stage || !PIPELINE_CFG[stage]) return null;
    const cfg = PIPELINE_CFG[stage];
    return (
        <span className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full border ${cfg.className}`}>
            {cfg.label}
        </span>
    );
}

function CompetitorBadge({ tech }: { tech: string[] }) {
    const label = tech.length > 0
        ? tech.slice(0, 2).map((t) => t.replace(/_/g, " ")).join(", ") + (tech.length > 2 ? ` +${tech.length - 2}` : "")
        : "Competitor user";
    return (
        <span
            className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-400/10 text-orange-400 border border-orange-400/25 uppercase tracking-wider whitespace-nowrap"
            title={`Uses competing tech: ${tech.join(", ") || "unknown"}`}
        >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15v-4H7l5-8v4h4l-5 8z" />
            </svg>
            {label}
        </span>
    );
}

function EmailStatusBadge({ status }: { status: Lead["emailStatus"] }) {
    const cfgMap = {
        VERIFIED: { label: "Verified", icon: "✓", className: "bg-emerald-400/10 text-emerald-400 border-emerald-400/20" },
        DELIVERED: { label: "Delivered", icon: "✓", className: "bg-sky-400/10 text-sky-400 border-sky-400/20" },
        BOUNCED: { label: "Bounced", icon: "✕", className: "bg-[var(--red-glow)] text-[var(--red)] border-[var(--border-red)]" },
        NOT_ATTEMPTED: { label: "Unverified", icon: "?", className: "bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]" },
    };
    if (!status || !cfgMap[status]) return null;
    const cfg = cfgMap[status];
    return (
        <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${cfg.className}`}>
            <span className="font-bold">{cfg.icon}</span> {cfg.label}
        </span>
    );
}

/* ─── Stats bar ─── */
function StatsBar({ leads, total }: { leads: Lead[]; total: number }) {
    const hp = leads.filter((l) => l.recommendedAction === "HIGH_PRIORITY").length;
    const scored = leads.filter((l) => l.qualificationScore != null);
    const avg = scored.length
        ? Math.round(scored.reduce((s, l) => s + (l.qualificationScore ?? 0), 0) / scored.length)
        : 0;
    const replied = leads.filter((l) => l._count.replies > 0).length;
    const verified = leads.filter((l) => l.emailVerified).length;

    const stats = [
        { label: "Showing", value: leads.length, sub: `of ${total.toLocaleString()} total`, color: "text-[var(--text-primary)]" },
        {
            label: "High Priority",
            value: hp,
            sub: `${Math.round((hp / Math.max(leads.length, 1)) * 100)}% of view`,
            color: "text-[var(--red)]",
        },
        {
            label: "Avg Score",
            value: avg,
            sub: "across filtered",
            color: avg >= 75 ? "text-emerald-400" : avg >= 55 ? "text-amber-400" : "text-[var(--red)]",
        },
        {
            label: "Replied",
            value: replied,
            sub: `${Math.round((replied / Math.max(leads.length, 1)) * 100)}% reply rate`,
            color: "text-emerald-400",
        },
        {
            label: "Email Verified",
            value: verified,
            sub: `${leads.length - verified} unverified`,
            color: "text-sky-400",
        },
    ];

    return (
        <div className="grid grid-cols-5 border-b border-[var(--border)] bg-[var(--navy-mid)]" style={{ borderTop: "none" }}>
            {stats.map((s, i) => (
                <div
                    key={s.label}
                    className={`flex flex-col gap-0.5 px-5 py-3 ${i < 4 ? "border-r border-[var(--border)]" : ""}`}
                >
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">{s.label}</span>
                    <span className={`text-xl font-bold tabular-nums leading-tight ${s.color}`}>{s.value}</span>
                    <span className="text-[10px] text-[var(--text-muted)]">{s.sub}</span>
                </div>
            ))}
        </div>
    );
}

/* ─── Score breakdown mini bars ─── */
function ScoreBreakdown({ scores }: { scores: BreakdownScores }) {
    const dims = [
        { label: "ICP Match", val: scores.icpMatch },
        { label: "Intent", val: scores.intentStrength },
        { label: "Funding", val: scores.fundingSignals },
        { label: "Hiring", val: scores.hiringVelocity },
        { label: "Tech Fit", val: scores.techFit },
        { label: "Recency", val: scores.recency },
    ];
    return (
        <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
            {dims.map((d) => {
                const color = d.val >= 80 ? "bg-emerald-400" : d.val >= 60 ? "bg-amber-400" : d.val >= 40 ? "bg-orange-400" : "bg-[var(--red)]";
                const textColor = d.val >= 80 ? "text-emerald-400" : d.val >= 60 ? "text-amber-400" : d.val >= 40 ? "text-orange-400" : "text-[var(--red)]";
                return (
                    <div key={d.label} className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                            <div className="text-[10px] text-[var(--text-muted)] mb-1">{d.label}</div>
                            <div className="h-1 rounded-full bg-[var(--surface-2)] overflow-hidden">
                                <div className={`h-full rounded-full ${color}`} style={{ width: `${d.val}%` }} />
                            </div>
                        </div>
                        <span className={`text-[11px] font-semibold tabular-nums min-w-[24px] text-right ${textColor}`}>{d.val}</span>
                    </div>
                );
            })}
        </div>
    );
}

/* ─── Evidence triggers ─── */
function EvidenceTriggers({ triggers }: { triggers: string[] }) {
    if (!triggers.length) return <p className="text-xs text-[var(--text-muted)]">No evidence collected yet</p>;
    return (
        <div className="flex flex-col gap-2">
            {triggers.map((t, i) => (
                <div key={i} className="flex items-start gap-2">
                    <span className="flex-shrink-0 mt-0.5 w-4 h-4 rounded bg-sky-400/10 border border-sky-400/20 flex items-center justify-center">
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-sky-400" aria-hidden="true">
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94" />
                            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                        </svg>
                    </span>
                    <span className="text-xs text-[var(--text-secondary)] leading-relaxed">{t}</span>
                </div>
            ))}
        </div>
    );
}

/* ─── Expanded row ─── */
function SourceBadge({ source }: { source?: string }) {
    if (!source) return null;
    const name = source.toLowerCase();
    let bg = "bg-slate-500/10 text-slate-400 border border-slate-500/20";
    if (name === "pdl") {
        bg = "bg-indigo-400/10 text-indigo-400 border border-indigo-400/20";
    } else if (name === "proxycurl" || name === "pc") {
        bg = "bg-emerald-400/10 text-emerald-400 border border-emerald-400/20";
    } else if (name === "crunchbase" || name === "cb") {
        bg = "bg-amber-400/10 text-amber-400 border border-amber-400/20";
    }
    return (
        <span className={`inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wider ${bg}`}>
            {name === "pc" ? "Proxycurl" : name === "cb" ? "Crunchbase" : name}
        </span>
    );
}

function InfoRow({
    label,
    value,
    entry,
}: {
    label: string;
    value?: any;
    entry?: { source: string; fetchedAt: string };
}) {
    if (value == null) return null;
    const valueStr = Array.isArray(value) ? value.join(", ") : String(value);
    return (
        <div className="flex items-start justify-between py-2 border-b border-[var(--border)] last:border-0 text-xs">
            <span className="text-[var(--text-muted)] font-medium">{label}</span>
            <div className="flex items-center gap-2 max-w-[70%] text-right">
                <span className="text-[var(--text-primary)] font-semibold truncate" title={valueStr}>
                    {valueStr}
                </span>
                {entry?.source && <SourceBadge source={entry.source} />}
            </div>
        </div>
    );
}

function ExpandedRow({ lead, onReenriched }: { lead: Lead; onReenriched?: () => void }) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<any>(null);
    const [activeTab, setActiveTab] = useState<"overview" | "enrichment" | "research">("overview");

    const [editMode, setEditMode] = useState(!lead.firstName && !lead.email);
    const [editFields, setEditFields] = useState({
        firstName: lead.firstName ?? "",
        lastName: lead.lastName ?? "",
        email: lead.email ?? "",
        title: lead.title ?? "",
        website: lead.website ?? "",
        linkedinUrl: lead.linkedinUrl ?? "",
    });
    const [saveLoading, setSaveLoading] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [saveSuccess, setSaveSuccess] = useState(false);

    async function handleSaveContact() {
        setSaveLoading(true);
        setSaveError(null);
        setSaveSuccess(false);
        try {
            const body: Record<string, string | null> = {};
            if (editFields.firstName.trim()) body.firstName = editFields.firstName.trim();
            else body.firstName = null;
            if (editFields.lastName.trim()) body.lastName = editFields.lastName.trim();
            else body.lastName = null;
            if (editFields.email.trim()) body.email = editFields.email.trim();
            else body.email = null;
            if (editFields.title.trim()) body.title = editFields.title.trim();
            else body.title = null;
            if (editFields.website.trim()) body.website = editFields.website.trim();
            else body.website = null;
            if (editFields.linkedinUrl.trim()) body.linkedinUrl = editFields.linkedinUrl.trim();
            else body.linkedinUrl = null;

            const res = await fetch(`/api/leads/${lead.id}`, {
                method: "PATCH",
                headers: authHeaders(),
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const errText = await res.text().catch(() => `HTTP ${res.status}`);
                throw new Error(errText);
            }
            setSaveSuccess(true);
            setEditMode(false);
            onReenriched?.();
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : "Save failed");
        } finally {
            setSaveLoading(false);
        }
    }

    async function handleReenrich() {
        setLoading(true);
        setError(null);
        setResult(null);
        try {
            const res = await fetch(`/api/leads/${lead.id}/enrich`, {
                method: "POST",
                headers: authHeaders(),
            });
            if (!res.ok) throw new Error(await res.text());
            const json = await res.json();
            setResult(json);
            onReenriched?.();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Enrichment failed");
        } finally {
            setLoading(false);
        }
    }

    const data = lead.enrichmentData as any;
    const company = data?.company;
    const person = data?.person;
    const hasEnrichment = company != null || person != null;

    const formatCurrency = (val?: number) => {
        if (val == null) return undefined;
        return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val);
    };

    return (
        <div className="px-6 py-5">
                <div className="flex gap-4 border-b border-[var(--border)] mb-4 pb-2">
                    <button
                        onClick={() => setActiveTab("overview")}
                        className={`text-xs font-semibold pb-1.5 focus:outline-none transition-all cursor-pointer ${activeTab === "overview"
                                ? "text-[var(--text-primary)] border-b-2 border-[var(--red)]"
                                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                            }`}
                    >
                        Overview
                    </button>
                    <button
                        onClick={() => setActiveTab("enrichment")}
                        className={`text-xs font-semibold pb-1.5 focus:outline-none transition-all cursor-pointer ${activeTab === "enrichment"
                                ? "text-[var(--text-primary)] border-b-2 border-[var(--red)]"
                                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                            }`}
                    >
                        Enrichment Profile
                    </button>
                    <button
                        onClick={() => setActiveTab("research")}
                        className={`text-xs font-semibold pb-1.5 focus:outline-none transition-all cursor-pointer ${activeTab === "research"
                                ? "text-[var(--text-primary)] border-b-2 border-[var(--red)]"
                                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                            }`}
                    >
                        Research
                    </button>
                </div>

                {activeTab === "overview" ? (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 animate-fade-in">
                        {/* Contact */}
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-widest">Contact</p>
                                {!editMode && (
                                    <button
                                        onClick={() => setEditMode(true)}
                                        className="text-[10px] font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer focus-visible:outline-none"
                                        aria-label="Edit contact details"
                                    >
                                        Edit
                                    </button>
                                )}
                            </div>
                            {editMode ? (
                                <div className="space-y-2">
                                    <div className="grid grid-cols-2 gap-2">
                                        <input
                                            type="text"
                                            placeholder="First name"
                                            value={editFields.firstName}
                                            onChange={e => setEditFields(f => ({ ...f, firstName: e.target.value }))}
                                            className="text-xs px-2 py-1.5 rounded-md bg-[var(--surface)] border border-[var(--border)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--red)] transition-colors"
                                            aria-label="First name"
                                        />
                                        <input
                                            type="text"
                                            placeholder="Last name"
                                            value={editFields.lastName}
                                            onChange={e => setEditFields(f => ({ ...f, lastName: e.target.value }))}
                                            className="text-xs px-2 py-1.5 rounded-md bg-[var(--surface)] border border-[var(--border)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--red)] transition-colors"
                                            aria-label="Last name"
                                        />
                                    </div>
                                    <input
                                        type="email"
                                        placeholder="Email address"
                                        value={editFields.email}
                                        onChange={e => setEditFields(f => ({ ...f, email: e.target.value }))}
                                        className="w-full text-xs px-2 py-1.5 rounded-md bg-[var(--surface)] border border-[var(--border)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--red)] transition-colors"
                                        aria-label="Email address"
                                    />
                                    <input
                                        type="text"
                                        placeholder="Job title"
                                        value={editFields.title}
                                        onChange={e => setEditFields(f => ({ ...f, title: e.target.value }))}
                                        className="w-full text-xs px-2 py-1.5 rounded-md bg-[var(--surface)] border border-[var(--border)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--red)] transition-colors"
                                        aria-label="Job title"
                                    />
                                    <input
                                        type="url"
                                        placeholder="Website"
                                        value={editFields.website}
                                        onChange={e => setEditFields(f => ({ ...f, website: e.target.value }))}
                                        className="w-full text-xs px-2 py-1.5 rounded-md bg-[var(--surface)] border border-[var(--border)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--red)] transition-colors"
                                        aria-label="Website"
                                    />
                                    <input
                                        type="url"
                                        placeholder="LinkedIn URL"
                                        value={editFields.linkedinUrl}
                                        onChange={e => setEditFields(f => ({ ...f, linkedinUrl: e.target.value }))}
                                        className="w-full text-xs px-2 py-1.5 rounded-md bg-[var(--surface)] border border-[var(--border)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--red)] transition-colors"
                                        aria-label="LinkedIn URL"
                                    />
                                    <div className="flex items-center gap-2 pt-1">
                                        <button
                                            onClick={handleSaveContact}
                                            disabled={saveLoading}
                                            className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-[var(--red)] text-white disabled:opacity-50 transition-all focus-visible:outline-none cursor-pointer hover:opacity-90"
                                            aria-label="Save contact details"
                                        >
                                            {saveLoading ? (
                                                <svg className="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                                                    <circle cx="12" cy="12" r="10" />
                                                </svg>
                                            ) : null}
                                            {saveLoading ? "Saving..." : "Save Changes"}
                                        </button>
                                        <button
                                            onClick={() => { setEditMode(false); setSaveError(null); }}
                                            disabled={saveLoading}
                                            className="text-[11px] font-semibold text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors focus-visible:outline-none cursor-pointer"
                                            aria-label="Cancel editing"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                    {saveError && <p className="text-[10px] text-[var(--red)] mt-1">{saveError}</p>}
                                    {saveSuccess && <p className="text-[10px] text-emerald-400 mt-1">✓ Saved</p>}
                                </div>
                            ) : (
                                <div className="space-y-1.5">
                                    {lead.email && (
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <a href={`mailto:${lead.email}`} className="flex items-center gap-1.5 text-xs text-sky-400 hover:underline focus-visible:outline-none focus-visible:underline">
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                                                    <polyline points="22,6 12,13 2,6" />
                                                </svg>
                                                {lead.email}
                                            </a>
                                            {lead.emailStatus && <EmailStatusBadge status={lead.emailStatus} />}
                                        </div>
                                    )}
                                    {lead.website && (
                                        <a href={`https://${lead.website.replace(/^https?:\/\//, "")}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-sky-400 hover:underline focus-visible:outline-none focus-visible:underline">
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
                                                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                                            </svg>
                                            {lead.website}
                                        </a>
                                    )}
                                    {lead.linkedinUrl && (
                                        <a href={lead.linkedinUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-sky-400 hover:underline focus-visible:outline-none focus-visible:underline">
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                                <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6zM2 9h4v12H2z" />
                                                <circle cx="4" cy="4" r="2" />
                                            </svg>
                                            LinkedIn profile
                                        </a>
                                    )}
                                    {!lead.email && !lead.website && !lead.linkedinUrl && (
                                        <p className="text-xs text-[var(--text-muted)]">No contact info — click Edit to add</p>
                                    )}
                                    {lead.pipelineStage && (
                                        <div className="pt-1">
                                            <PipelinePill stage={lead.pipelineStage} />
                                        </div>
                                    )}
                                    {lead.competitorSignal && (
                                        <div className="pt-2">
                                            <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-widest mb-1">Competitor Tech</p>
                                            <CompetitorBadge tech={lead.competitorTech ?? []} />
                                            {lead.competitorTech?.length > 0 && (
                                                <p className="text-[10px] text-orange-400 mt-1.5 leading-relaxed">
                                                    Displacement opportunity: this company currently uses a competing product.
                                                </p>
                                            )}
                                        </div>
                                    )}
                                    <div className="pt-3 border-t border-[var(--border)] mt-2">
                                        <button
                                            onClick={handleReenrich}
                                            disabled={loading}
                                            className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] disabled:opacity-50 transition-all focus-visible:outline-none cursor-pointer"
                                        >
                                            {loading ? (
                                                <svg className="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                                                    <circle cx="12" cy="12" r="10" />
                                                </svg>
                                            ) : null}
                                            {loading ? "Enriching..." : "Re-enrich Lead"}
                                        </button>
                                        {error && <p className="text-[10px] text-[var(--red)] mt-1">{error}</p>}
                                        {result && (
                                            <p className="text-[10px] text-emerald-400 mt-1">
                                                ✓ Enriched: {result.fieldsAdded?.length ?? 0} fields added
                                            </p>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Score breakdown */}
                        <div>
                            <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-widest mb-3">Score Breakdown</p>
                            {lead.breakdownScores
                                ? <ScoreBreakdown scores={lead.breakdownScores} />
                                : <p className="text-xs text-[var(--text-muted)]">Not yet scored</p>}
                        </div>

                        {/* Evidence triggers */}
                        <div>
                            <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-widest mb-3">Evidence</p>
                            <EvidenceTriggers triggers={lead.evidenceTriggers ?? []} />
                        </div>

                        {/* Signals + AI reasoning */}
                        <div>
                            <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-widest mb-3">
                                Signals ({lead.signals.length})
                            </p>
                            {lead.signals.length === 0 ? (
                                <p className="text-xs text-[var(--text-muted)]">No signals detected</p>
                            ) : (
                                <div className="space-y-1.5 mb-4">
                                    {lead.signals.map((sig) => {
                                        const rawType = sig.signalType ?? sig.type ?? "UNKNOWN_SIGNAL";
                                        const cfg = SIGNAL_COLORS[rawType] ?? SIGNAL_COLORS.CONTENT;
                                        return (
                                            <div key={sig.id} className="flex items-center gap-2">
                                                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${cfg.bg} ${cfg.text}`}>
                                                    {rawType.replace(/_SIGNAL$/, "").replace(/_/g, " ")}
                                                </span>
                                                <span className="text-xs text-[var(--text-secondary)] truncate flex-1">{sig.value}</span>
                                                <span className="text-xs text-[var(--text-muted)] tabular-nums flex-shrink-0">
                                                    {(sig.confidence * 100).toFixed(0)}%
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            {lead.qualificationReason && (
                                <div className="pt-3 border-t border-[var(--border)]">
                                    <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-widest mb-1.5">AI Reasoning</p>
                                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{lead.qualificationReason}</p>
                                </div>
                            )}
                        </div>
                    </div>
                ) : activeTab === "enrichment" ? (
                    <div className="animate-fade-in">
                        {hasEnrichment ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                {/* Company Enrichment */}
                                {company && (
                                    <div className="bg-[var(--surface)] p-4 rounded-xl border border-[var(--border)]">
                                        <div className="flex items-center justify-between mb-4 border-b border-[var(--border)] pb-2">
                                            <h4 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider flex items-center gap-2">
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <rect x="2" y="10" width="20" height="12" rx="2" />
                                                    <path d="M6 10V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6" />
                                                </svg>
                                                Company Intelligence
                                            </h4>
                                        </div>
                                        <div className="space-y-0.5">
                                            <InfoRow label="Company Name" value={company.name} entry={company.providerMap?.name} />
                                            <InfoRow label="Domain" value={company.domain} entry={company.providerMap?.domain} />
                                            <InfoRow label="Industry" value={company.industry} entry={company.providerMap?.industry} />
                                            <InfoRow label="Employees" value={company.employeeCount} entry={company.providerMap?.employeeCount} />
                                            <InfoRow label="Founded Year" value={company.foundedYear} entry={company.providerMap?.foundedYear} />
                                            <InfoRow label="Total Funding" value={formatCurrency(company.fundingTotalUsd)} entry={company.providerMap?.fundingTotalUsd} />
                                            <InfoRow label="Country" value={company.country} entry={company.providerMap?.country} />
                                            <InfoRow label="LinkedIn Company" value={company.linkedinUrl} entry={company.providerMap?.linkedinUrl} />
                                            {company.description && (
                                                <div className="pt-3 border-t border-[var(--border)] mt-2 text-xs">
                                                    <div className="flex items-center justify-between mb-1">
                                                        <span className="text-[var(--text-muted)] font-medium">Description</span>
                                                        {company.providerMap?.description?.source && <SourceBadge source={company.providerMap.description.source} />}
                                                    </div>
                                                    <p className="text-[var(--text-secondary)] leading-relaxed text-[11px]">{company.description}</p>
                                                </div>
                                            )}
                                            {company.techStack && company.techStack.length > 0 && (
                                                <div className="pt-3 border-t border-[var(--border)] mt-2">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-widest">Technologies</span>
                                                        {company.providerMap?.techStack?.source && <SourceBadge source={company.providerMap.techStack.source} />}
                                                    </div>
                                                    <div className="flex flex-wrap gap-1">
                                                        {company.techStack.map((tech: string) => (
                                                            <span
                                                                key={tech}
                                                                className="text-[9px] font-medium px-2 py-0.5 rounded bg-[var(--surface-2)] text-[var(--text-secondary)] border border-[var(--border)] hover:text-[var(--text-primary)] hover:border-[var(--red-dim)] transition-colors duration-150"
                                                            >
                                                                {tech}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Person Enrichment */}
                                {person && (
                                    <div className="bg-[var(--surface)] p-4 rounded-xl border border-[var(--border)]">
                                        <div className="flex items-center justify-between mb-4 border-b border-[var(--border)] pb-2">
                                            <h4 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider flex items-center gap-2">
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                                                    <circle cx="12" cy="7" r="4" />
                                                </svg>
                                                Contact Intelligence
                                            </h4>
                                        </div>
                                        <div className="space-y-0.5">
                                            <InfoRow label="First Name" value={person.firstName} entry={person.providerMap?.firstName} />
                                            <InfoRow label="Last Name" value={person.lastName} entry={person.providerMap?.lastName} />
                                            <InfoRow label="Email" value={person.email} entry={person.providerMap?.email} />
                                            <InfoRow label="Phone" value={person.phone} entry={person.providerMap?.phone} />
                                            <InfoRow label="Job Title" value={person.title} entry={person.providerMap?.title} />
                                            <InfoRow label="Seniority" value={person.seniority} entry={person.providerMap?.seniority} />
                                            <InfoRow label="Department" value={person.department} entry={person.providerMap?.department} />
                                            <InfoRow label="LinkedIn Profile" value={person.linkedinUrl} entry={person.providerMap?.linkedinUrl} />
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center py-12 text-center gap-3 bg-[var(--surface)] rounded-xl border border-dashed border-[var(--border)]">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--text-muted)]" aria-hidden="true">
                                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                                </svg>
                                <div>
                                    <p className="text-xs font-semibold text-[var(--text-secondary)]">No enrichment details cached</p>
                                    <p className="text-[11px] text-[var(--text-muted)] max-w-xs mt-1">
                                        Use the re-enrich button on the overview tab to trigger the multi-provider waterfall pipeline for this lead.
                                    </p>
                                </div>
                                <button
                                    onClick={handleReenrich}
                                    disabled={loading}
                                    className="inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg bg-[var(--red)] text-white hover:bg-[var(--red-dim)] disabled:opacity-50 transition-all focus-visible:outline-none cursor-pointer"
                                >
                                    {loading ? "Enriching..." : "Enrich Lead Now"}
                                </button>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="animate-fade-in">
                        <LeadResearchPanel
                            leadId={lead.id}
                            leadName={[lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Prospect"}
                            companyName={lead.companyName}
                        />
                    </div>
                )}
        </div>
    );
}

function LeadDetailModal({ lead, onClose, onSaved }: { lead: Lead; onClose: () => void; onSaved: () => void }) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const name = lead.firstName ? `${lead.firstName} ${lead.lastName ?? ""}`.trim() : null;
    const initial = (lead.firstName?.[0] ?? lead.companyName[0]).toUpperCase();
    const actionCfg = lead.recommendedAction ? ACTION_CFG[lead.recommendedAction] : null;

    useEffect(() => {
        const el = dialogRef.current;
        if (el && !el.open) el.showModal();
    }, []);

    function handleCancel(e: React.SyntheticEvent) {
        e.preventDefault();
        onClose();
    }

    function handleBackdrop(e: React.MouseEvent<HTMLDialogElement>) {
        if (e.target === dialogRef.current) onClose();
    }

    return (
        <dialog
            ref={dialogRef}
            onCancel={handleCancel}
            onClick={handleBackdrop}
            aria-labelledby="lead-detail-modal-title"
            className="modal-panel m-auto w-full max-w-5xl bg-transparent p-4 backdrop:bg-black/70 backdrop:backdrop-blur-md"
        >
            <div className="relative bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl flex flex-col overflow-hidden" style={{ maxHeight: "90vh" }}>
                <div className="flex items-center gap-4 px-6 pt-6 pb-5 border-b border-[var(--border)] flex-shrink-0">
                    <div
                        className="w-11 h-11 rounded-xl border border-[var(--border)] flex items-center justify-center text-sm font-bold flex-shrink-0 select-none"
                        style={{
                            background: actionCfg
                                ? undefined
                                : "linear-gradient(135deg, var(--navy-deep), var(--surface-2))",
                        }}
                        aria-hidden="true"
                    >
                        {actionCfg ? (
                            <span className={`${actionCfg.className.match(/text-[^\s]+/)?.[0] ?? "text-[var(--text-secondary)]"}`}>{initial}</span>
                        ) : (
                            <span className="text-[var(--text-secondary)]">{initial}</span>
                        )}
                    </div>
                    <div className="flex-1 min-w-0">
                        <h2 id="lead-detail-modal-title" className="text-base font-bold text-[var(--text-primary)] font-display truncate leading-none mb-0.5">
                            {name ?? lead.companyName}
                        </h2>
                        <div className="flex items-center gap-2 flex-wrap">
                            {name && <span className="text-xs text-[var(--text-muted)] truncate">{lead.companyName}</span>}
                            {lead.title && <span className="text-xs text-[var(--text-muted)]">&middot; {lead.title}</span>}
                            {actionCfg && (
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${actionCfg.className}`}>
                                    {lead.recommendedAction?.replace(/_/g, " ")}
                                </span>
                            )}
                            {lead.pipelineStage && <PipelinePill stage={lead.pipelineStage} />}
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                        {lead.email && (
                            <a
                                href={`mailto:${lead.email}`}
                                className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--red-dim)] transition-all focus-visible:outline-none"
                                aria-label={`Email ${lead.email}`}
                            >
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                                    <polyline points="22,6 12,13 2,6" />
                                </svg>
                                Email
                            </a>
                        )}
                        {lead.linkedinUrl && (
                            <a
                                href={lead.linkedinUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--red-dim)] transition-all focus-visible:outline-none"
                                aria-label="LinkedIn profile"
                            >
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6zM2 9h4v12H2z" />
                                    <circle cx="4" cy="4" r="2" />
                                </svg>
                                LinkedIn
                            </a>
                        )}
                        <button
                            onClick={onClose}
                            className="flex items-center justify-center w-8 h-8 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                            aria-label="Close lead details"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        </button>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto">
                    <ExpandedRow lead={lead} onReenriched={onSaved} />
                </div>
            </div>
        </dialog>
    );
}

/* ─── Skeleton ─── */
function SkeletonRow() {
    return (
        <tr className="border-b border-[var(--border)]" aria-hidden="true">
            {/* Checkbox */}
            <td className="px-4 py-3"><div className="h-3 w-4 bg-[var(--surface-2)] rounded animate-pulse" /></td>
            {/* Expand */}
            <td className="px-2 py-3"><div className="h-3 w-6 bg-[var(--surface-2)] rounded animate-pulse" /></td>
            {/* Lead identity */}
            <td className="px-4 py-3"><div className="h-3 w-36 bg-[var(--surface-2)] rounded animate-pulse" /></td>
            {/* Campaign – hidden below md */}
            <td className="px-4 py-3 hidden md:table-cell"><div className="h-3 w-24 bg-[var(--surface-2)] rounded animate-pulse" /></td>
            {/* Score */}
            <td className="px-4 py-3"><div className="h-3 w-16 bg-[var(--surface-2)] rounded animate-pulse" /></td>
            {/* Action */}
            <td className="px-4 py-3"><div className="h-3 w-20 bg-[var(--surface-2)] rounded animate-pulse" /></td>
            {/* Pipeline – hidden below lg */}
            <td className="px-4 py-3 hidden lg:table-cell"><div className="h-3 w-16 bg-[var(--surface-2)] rounded animate-pulse" /></td>
            {/* Signals – hidden below xl */}
            <td className="px-4 py-3 hidden xl:table-cell"><div className="h-3 w-20 bg-[var(--surface-2)] rounded animate-pulse" /></td>
            {/* Msg – hidden below lg */}
            <td className="px-4 py-3 hidden lg:table-cell"><div className="h-3 w-8 bg-[var(--surface-2)] rounded animate-pulse" /></td>
            {/* Rep – hidden below lg */}
            <td className="px-4 py-3 hidden lg:table-cell"><div className="h-3 w-8 bg-[var(--surface-2)] rounded animate-pulse" /></td>
            {/* Added – hidden below xl */}
            <td className="px-4 py-3 hidden xl:table-cell"><div className="h-3 w-12 bg-[var(--surface-2)] rounded animate-pulse" /></td>
            {/* Row actions */}
            <td className="px-4 py-3"><div className="h-3 w-12 bg-[var(--surface-2)] rounded animate-pulse" /></td>
        </tr>
    );
}

/* ─── Empty state ─── */
function EmptyState({ hasFilters }: { hasFilters: boolean }) {
    return (
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-center" role="status">
            <div className="w-14 h-14 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center text-[var(--text-muted)]">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
            </div>
            <div>
                <p className="text-sm font-semibold text-[var(--text-secondary)]">
                    {hasFilters ? "No leads match your filters" : "No leads yet"}
                </p>
                <p className="text-xs text-[var(--text-muted)] mt-1 max-w-[260px]">
                    {hasFilters
                        ? "Try adjusting the score slider or clearing the action filter"
                        : "Leads will appear here after the AI research phase runs"}
                </p>
            </div>
            {!hasFilters && (
                <Link
                    href="/dashboard/campaigns"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg bg-[var(--red)] text-white hover:bg-[var(--red-dim)] active:scale-[0.97] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    Go to Campaigns
                </Link>
            )}
        </div>
    );
}

function DeleteModal({
    lead,
    onConfirm,
    onCancel,
    isDeleting,
}: {
    lead: Lead;
    onConfirm: () => void;
    onCancel: () => void;
    isDeleting: boolean;
}) {
    const dialogRef = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        const el = dialogRef.current;
        if (el && !el.open) el.showModal();
    }, []);

    function handleCancel(e: React.SyntheticEvent) {
        e.preventDefault();
        onCancel();
    }

    function handleBackdrop(e: React.MouseEvent<HTMLDialogElement>) {
        if (e.target === dialogRef.current) onCancel();
    }

    return (
        <dialog
            ref={dialogRef}
            onCancel={handleCancel}
            onClick={handleBackdrop}
            aria-labelledby="delete-modal-title"
            className="modal-panel m-auto w-full max-w-sm bg-transparent p-4 backdrop:bg-black/60 backdrop:backdrop-blur-sm"
        >
            <div className="relative bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 w-full shadow-2xl">
                <div className="flex items-start gap-4 mb-5">
                    <div className="w-10 h-10 rounded-xl bg-[var(--red-glow)] flex items-center justify-center text-[var(--red)] flex-shrink-0">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            <path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                        </svg>
                    </div>
                    <div>
                        <h2 id="delete-modal-title" className="text-sm font-semibold text-[var(--text-primary)] font-display">Delete lead?</h2>
                        <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                            <span className="font-medium text-[var(--text-primary)]">
                                {lead.firstName ? `${lead.firstName} ${lead.lastName ?? ""}` : lead.companyName}
                            </span>{" "}
                            will be permanently deleted along with all messages and replies. This cannot be undone.
                        </p>
                    </div>
                </div>
                <div className="flex gap-2 justify-end">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-xs font-medium rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={isDeleting}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-[var(--red)] text-white hover:bg-[var(--red-dim)] disabled:opacity-60 active:scale-[0.97] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        {isDeleting ? (
                            <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                            </svg>
                        ) : null}
                        {isDeleting ? "Deleting…" : "Delete lead"}
                    </button>
                </div>
            </div>
        </dialog>
    );
}

/* ─── Sort button ─── */
function SortButton({
    field,
    label,
    sortField,
    sortDir,
    onSort,
}: {
    field: SortField;
    label: string;
    sortField: SortField;
    sortDir: SortDir;
    onSort: (f: SortField) => void;
}) {
    const active = sortField === field;
    return (
        <button
            onClick={() => onSort(field)}
            className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors duration-150 focus-visible:outline-none focus-visible:underline group"
            aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
        >
            {label}
            <svg
                width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                className={`transition-all duration-150 ${active ? "text-[var(--red)]" : "opacity-0 group-hover:opacity-50"} ${active && sortDir === "asc" ? "rotate-180" : ""}`}
                aria-hidden="true"
            >
                <polyline points="6 9 12 15 18 9" />
            </svg>
        </button>
    );
}

/* ─── Add Lead Sheet ─── */
function AddLeadSheet({
    campaigns,
    onClose,
    onSaved,
}: {
    campaigns: Campaign[];
    onClose: () => void;
    onSaved: () => void;
}) {
    const [form, setForm] = useState({
        campaignId: campaigns[0]?.id ?? "",
        firstName: "",
        lastName: "",
        email: "",
        title: "",
        companyName: "",
        website: "",
        linkedinUrl: "",
    });
    const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string>>>({});
    const [saving, setSaving] = useState(false);
    const [serverError, setServerError] = useState<string | null>(null);
    const [visible, setVisible] = useState(false);
    const dialogRef = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        const el = dialogRef.current;
        if (!el) return;
        if (!el.open) el.showModal();
        requestAnimationFrame(() => setVisible(true));
    }, []);

    function handleCancel(e: React.SyntheticEvent) {
        e.preventDefault();
        onClose();
    }

    function validate(): boolean {
        const errs: Partial<Record<string, string>> = {};
        if (!form.companyName.trim()) errs.companyName = "Company name is required";
        if (!form.campaignId) errs.campaignId = "Please select a campaign";
        if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = "Invalid email address";
        if (form.linkedinUrl && !form.linkedinUrl.startsWith("https://")) errs.linkedinUrl = "Must start with https://";
        setFieldErrors(errs);
        return Object.keys(errs).length === 0;
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!validate()) return;
        setSaving(true);
        setServerError(null);
        try {
            const body: Record<string, string> = { companyName: form.companyName.trim(), campaignId: form.campaignId };
            if (form.firstName) body.firstName = form.firstName;
            if (form.lastName) body.lastName = form.lastName;
            if (form.email) body.email = form.email;
            if (form.title) body.title = form.title;
            if (form.website) body.website = form.website;
            if (form.linkedinUrl) body.linkedinUrl = form.linkedinUrl;
            const res = await fetch(`/api/leads`, { method: "POST", headers: authHeaders(), body: JSON.stringify(body) });
            if (!res.ok) { const json = await res.json(); throw new Error(json.error ?? "Failed to create lead"); }
            onSaved();
        } catch (err) {
            setServerError(err instanceof Error ? err.message : "Something went wrong");
        } finally {
            setSaving(false);
        }
    }

    const inputBase = "w-full px-3 py-2 text-sm bg-[var(--surface-2)] border rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--red)] transition-colors duration-150";
    function inputCls(key: string) {
        return fieldErrors[key]
            ? `${inputBase} border-[var(--red)]/60 focus:border-[var(--red)]`
            : `${inputBase} border-[var(--border)] focus:border-[var(--border-red)]`;
    }

    function field(label: string, key: keyof typeof form, opts?: { required?: boolean; type?: string; placeholder?: string }) {
        const err = fieldErrors[key as string];
        const id = `field-${String(key)}`;
        const errId = `${id}-error`;
        return (
            <div>
                <label htmlFor={id} className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-widest mb-1.5">
                    {label}{opts?.required && <span className="text-[var(--red)] ml-1" aria-label="required">*</span>}
                </label>
                <input
                    id={id}
                    type={opts?.type ?? "text"}
                    value={form[key]}
                    onChange={(e) => { setForm((p) => ({ ...p, [key]: e.target.value })); setFieldErrors((p) => ({ ...p, [key]: undefined })); }}
                    placeholder={opts?.placeholder}
                    required={opts?.required}
                    aria-required={opts?.required}
                    aria-invalid={err ? "true" : undefined}
                    aria-describedby={err ? errId : undefined}
                    autoComplete={opts?.type === "email" ? "email" : "off"}
                    className={inputCls(key as string)}
                />
                {err && <p id={errId} role="alert" className="mt-1 text-[11px] text-[var(--red)]">{err}</p>}
            </div>
        );
    }

    return (
        <dialog
            ref={dialogRef}
            onCancel={handleCancel}
            aria-labelledby="add-lead-title"
            className="sheet-panel"
        >
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                onClick={onClose}
                aria-hidden="true"
            />
            <div
                className={[
                    "absolute top-0 right-0 h-full w-full max-w-md bg-[var(--surface)] border-l border-[var(--border)] flex flex-col shadow-2xl",
                    "transition-transform duration-300 ease-in-out",
                    visible ? "translate-x-0" : "translate-x-full",
                ].join(" ")}
            >
                <div className="flex items-center justify-between px-6 py-5 border-b border-[var(--border)] flex-shrink-0">
                    <div>
                        <h2 id="add-lead-title" className="text-sm font-semibold font-display text-[var(--text-primary)]">Add Lead</h2>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">Manually add a lead to a campaign</p>
                    </div>
                    <button onClick={onClose} aria-label="Close" className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>
                <form onSubmit={handleSubmit} noValidate className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                    <div>
                        <label htmlFor="field-campaign" className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-widest mb-1.5">
                            Campaign <span className="text-[var(--red)]" aria-label="required">*</span>
                        </label>
                        <select
                            id="field-campaign"
                            value={form.campaignId}
                            onChange={(e) => { setForm((p) => ({ ...p, campaignId: e.target.value })); setFieldErrors((p) => ({ ...p, campaignId: undefined })); }}
                            required
                            aria-required="true"
                            aria-invalid={fieldErrors.campaignId ? "true" : undefined}
                            aria-describedby={fieldErrors.campaignId ? "field-campaign-error" : undefined}
                            className={inputCls("campaignId")}
                        >
                            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        {fieldErrors.campaignId && (
                            <p id="field-campaign-error" role="alert" className="mt-1 text-[11px] text-[var(--red)]">{fieldErrors.campaignId}</p>
                        )}
                    </div>
                    {field("Company Name", "companyName", { required: true, placeholder: "Acme Corp" })}
                    <div className="grid grid-cols-2 gap-3">
                        {field("First Name", "firstName", { placeholder: "Jane" })}
                        {field("Last Name", "lastName", { placeholder: "Smith" })}
                    </div>
                    {field("Job Title", "title", { placeholder: "CEO" })}
                    {field("Email", "email", { type: "email", placeholder: "jane@acme.com" })}
                    {field("Website", "website", { placeholder: "https://acme.com" })}
                    {field("LinkedIn URL", "linkedinUrl", { placeholder: "https://linkedin.com/in/…" })}
                    {serverError && (
                        <p role="alert" className="text-xs text-[var(--red)] bg-[var(--red-glow)] border border-[var(--border-red)] px-3 py-2 rounded-lg">
                            {serverError}
                        </p>
                    )}
                </form>
                <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[var(--border)] flex-shrink-0">
                    <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-medium rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]">
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={saving}
                        onClick={handleSubmit}
                        className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-[var(--red)] text-white hover:bg-[var(--red-dim)] disabled:opacity-50 active:scale-[0.97] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        {saving && <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>}
                        {saving ? "Adding…" : "Add Lead"}
                    </button>
                </div>
            </div>
        </dialog>
    );
}

/* ─── Main component ─── */
export default function LeadsPage() {
    const [leads, setLeads] = useState<Lead[]>([]);
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [meta, setMeta] = useState<PaginationMeta>({ total: 0, page: 1, limit: 20, totalPages: 1 });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [campaignFilter, setCampaignFilter] = useState<string>("");
    // New filters
    const [actionFilter, setActionFilter] = useState<string>("");
    const [minScore, setMinScore] = useState(0);
    const [competitorOnly, setCompetitorOnly] = useState(false);
    const [page, setPage] = useState(1);
    const [sortField, setSortField] = useState<SortField>("createdAt");
    const [sortDir, setSortDir] = useState<SortDir>("desc");

    const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");

    useEffect(() => {
        const saved = localStorage.getItem("leads-density");
        if (saved === "comfortable" || saved === "compact") {
            setDensity(saved);
        }
    }, []);

    const changeDensity = (val: "comfortable" | "compact") => {
        setDensity(val);
        localStorage.setItem("leads-density", val);
    };

    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [deleteTarget, setDeleteTarget] = useState<Lead | null>(null);
    const [detailLead, setDetailLead] = useState<Lead | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [showAddSheet, setShowAddSheet] = useState(false);
    const [showCsvImport, setShowCsvImport] = useState(false);

    const [enriching, setEnriching] = useState(false);
    const [toast, setToast] = useState<string | null>(null);

    async function handleEnrich() {
        setEnriching(true);
        try {
            const res = await fetch("/api/leads/bulk/enrich", {
                method: "POST",
                headers: authHeaders(),
                body: JSON.stringify({ leadIds: Array.from(selectedIds) }),
            });
            if (!res.ok) throw new Error("Bulk enrichment failed");
            const json = await res.json();
            setToast(`${json.fieldsAdded} fields added across ${json.succeeded} leads`);
            setSelectedIds(new Set());
            loadLeads();
            setTimeout(() => setToast(null), 4000);
        } catch {
            setToast("Enrichment failed — check logs");
            setTimeout(() => setToast(null), 4000);
        } finally {
            setEnriching(false);
        }
    }

    useEffect(() => {
        const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 350);
        return () => clearTimeout(t);
    }, [search]);

    useEffect(() => {
        apiFetch<Campaign[]>("/campaigns").then(setCampaigns).catch(() => { });
    }, []);

    const loadLeads = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            if (campaigns.length === 0) {
                setLeads([]);
                setMeta({ total: 0, page: 1, limit: 20, totalPages: 1 });
                setLoading(false);
                return;
            }
            const params = new URLSearchParams({
                page: String(page),
                limit: "20",
                ...(campaignFilter && { campaignId: campaignFilter }),
                ...(debouncedSearch && { search: debouncedSearch }),
                ...(actionFilter && { recommendedAction: actionFilter }),
                ...(minScore > 0 && { minScore: String(minScore) }),
                ...(competitorOnly && { competitorSignal: "true" }),
            });
            const result = await apiFetch<{ data: Lead[]; meta: PaginationMeta }>(`/leads?${params}`);
            setLeads(result.data);
            setMeta(result.meta);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load leads");
        } finally {
            setLoading(false);
        }
    }, [campaignFilter, campaigns, page, debouncedSearch, actionFilter, minScore, competitorOnly]);

    useEffect(() => { loadLeads(); }, [loadLeads]);

    const sorted = useMemo(() => {
        return [...leads].sort((a, b) => {
            let av: string | number = 0;
            let bv: string | number = 0;
            if (sortField === "qualificationScore") { av = a.qualificationScore ?? -1; bv = b.qualificationScore ?? -1; }
            else if (sortField === "companyName") { av = a.companyName.toLowerCase(); bv = b.companyName.toLowerCase(); }
            else { av = a.createdAt; bv = b.createdAt; }
            if (av < bv) return sortDir === "asc" ? -1 : 1;
            if (av > bv) return sortDir === "asc" ? 1 : -1;
            return 0;
        });
    }, [leads, sortField, sortDir]);

    function handleSort(field: SortField) {
        if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        else { setSortField(field); setSortDir("desc"); }
    }

    function toggleSelect(id: string) {
        setSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    }
    function selectAll() {
        if (selectedIds.size === sorted.length) setSelectedIds(new Set());
        else setSelectedIds(new Set(sorted.map((l) => l.id)));
    }

    async function handleDelete() {
        if (!deleteTarget) return;
        setIsDeleting(true);
        try { await apiDelete(`/leads/${deleteTarget.id}`); setDeleteTarget(null); loadLeads(); }
        catch { }
        finally { setIsDeleting(false); }
    }

    const hasFilters = Boolean(debouncedSearch || campaignFilter || actionFilter || minScore > 0 || competitorOnly);
    const activeCampaignId = campaignFilter || campaigns[0]?.id || "";

    return (
        <>
            <div className="flex flex-col h-full overflow-hidden">
                {/* ── Header ── */}
                <header className="flex items-center justify-between h-16 px-6 border-b border-[var(--border)] bg-[var(--navy-mid)] flex-shrink-0">
                    <div>
                        <h1 className="text-base font-semibold font-display text-[var(--text-primary)] leading-none">Leads</h1>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            {loading ? "Loading…" : `${meta.total.toLocaleString()} total`}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            aria-label="Notifications"
                            className="relative flex items-center justify-center w-9 h-9 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
                            </svg>
                        </button>
                        <button
                            onClick={() => setShowCsvImport(true)}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] active:scale-[0.97] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                            </svg>
                            Import CSV
                        </button>
                        <button
                            onClick={() => setShowAddSheet(true)}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-[var(--red)] text-white hover:bg-[var(--red-dim)] active:scale-[0.97] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--navy-mid)]"
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                            Add Lead
                        </button>
                    </div>
                </header>

                {/* ── Stats bar ── */}
                {!loading && <StatsBar leads={leads} total={meta.total} />}

                {/* ── Filters ── */}
                <div className="flex items-center gap-2.5 px-6 py-3 border-b border-[var(--border)] bg-[var(--navy-mid)] flex-shrink-0 flex-wrap">
                    {/* Search */}
                    <div className="relative flex-1 min-w-[200px] max-w-sm">
                        <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                        <input
                            type="search"
                            placeholder="Search name, company, email…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            aria-label="Search leads"
                            className="w-full pl-9 pr-4 py-2 text-sm bg-[var(--surface)] border border-[var(--border)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-red)] focus:ring-1 focus:ring-[var(--red)] transition-colors duration-150"
                        />
                    </div>

                    {/* Campaign */}
                    <div className="relative">
                        <select
                            value={campaignFilter}
                            onChange={(e) => { setCampaignFilter(e.target.value); setPage(1); }}
                            aria-label="Filter by campaign"
                            className="appearance-none pl-3 pr-8 py-2 text-sm bg-[var(--surface)] border border-[var(--border)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-red)] focus:ring-1 focus:ring-[var(--red)] transition-colors duration-150 cursor-pointer"
                        >
                            <option value="">All campaigns</option>
                            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--text-muted)]" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <polyline points="6 9 12 15 18 9" />
                        </svg>
                    </div>

                    {/* Action filter — NEW */}
                    <div className="relative">
                        <select
                            value={actionFilter}
                            onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
                            aria-label="Filter by recommended action"
                            className="appearance-none pl-3 pr-8 py-2 text-sm bg-[var(--surface)] border border-[var(--border)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-red)] focus:ring-1 focus:ring-[var(--red)] transition-colors duration-150 cursor-pointer"
                        >
                            <option value="">All actions</option>
                            <option value="HIGH_PRIORITY">⚡ High Priority</option>
                            <option value="STANDARD">Standard</option>
                            <option value="NURTURE">Nurture</option>
                            <option value="DISQUALIFY">Disqualify</option>
                        </select>
                        <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--text-muted)]" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <polyline points="6 9 12 15 18 9" />
                        </svg>
                    </div>

                    {/* Score slider — NEW */}
                    <div className="flex items-center gap-2" aria-label="Minimum score filter">
                        <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">Score ≥</span>
                        <input
                            type="range" min={0} max={100} step={5} value={minScore}
                            onChange={(e) => { setMinScore(Number(e.target.value)); setPage(1); }}
                            className="w-24 accent-[var(--red)]"
                            aria-label={`Minimum score: ${minScore}`}
                        />
                        <span className={`text-xs font-semibold tabular-nums min-w-[24px] ${minScore > 0 ? "text-[var(--red)]" : "text-[var(--text-muted)]"}`}>
                            {minScore > 0 ? minScore : "—"}
                        </span>
                    </div>

                    {/* Competitor filter toggle */}
                    <button
                        onClick={() => { setCompetitorOnly(v => !v); setPage(1); }}
                        aria-pressed={competitorOnly}
                        aria-label="Show competitor users only"
                        title="Show leads using competitor products"
                        className={[
                            "inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400",
                            competitorOnly
                                ? "bg-orange-400/15 border-orange-400/40 text-orange-400"
                                : "bg-[var(--surface)] border-[var(--border)] text-[var(--text-muted)] hover:border-orange-400/30 hover:text-orange-400",
                        ].join(" ")}
                    >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15v-4H7l5-8v4h4l-5 8z" />
                        </svg>
                        Competitor users
                    </button>

                    {hasFilters && (
                        <button
                            onClick={() => { setSearch(""); setCampaignFilter(""); setActionFilter(""); setMinScore(0); setCompetitorOnly(false); setPage(1); }}
                            className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--red)] transition-colors duration-150 focus-visible:outline-none focus-visible:underline"
                            aria-label="Clear all filters"
                        >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                            Clear
                        </button>
                    )}

                    <div className="flex items-center gap-0.5 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg p-0.5 ml-auto">
                        <button
                            onClick={() => changeDensity("comfortable")}
                            aria-label="Comfortable layout"
                            className={`p-1.5 rounded transition-all duration-150 cursor-pointer ${density === "comfortable" ? "bg-[var(--red-glow)] text-[var(--red)] border border-[var(--border-red)]/20" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
                            </svg>
                        </button>
                        <button
                            onClick={() => changeDensity("compact")}
                            aria-label="Compact layout"
                            className={`p-1.5 rounded transition-all duration-150 cursor-pointer ${density === "compact" ? "bg-[var(--red-glow)] text-[var(--red)] border border-[var(--border-red)]/20" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <line x1="3" y1="4" x2="21" y2="4" /><line x1="3" y1="8" x2="21" y2="8" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="16" x2="21" y2="16" /><line x1="3" y1="20" x2="21" y2="20" />
                            </svg>
                        </button>
                    </div>

                    <span className="text-xs text-[var(--text-muted)] tabular-nums whitespace-nowrap">
                        {loading ? "…" : `${sorted.length.toLocaleString()} leads`}
                    </span>
                </div>

                {/* ── Bulk action bar ── */}
                {selectedIds.size > 0 && (
                    <div className="flex items-center gap-3 px-6 py-2.5 bg-sky-400/5 border-b border-sky-400/20 flex-shrink-0" role="toolbar" aria-label="Bulk actions">
                        <span className="text-xs font-semibold text-sky-400">{selectedIds.size} selected</span>
                        <div className="h-3 w-px bg-[var(--border)]" aria-hidden="true" />
                        <button className="text-xs font-medium px-3 py-1.5 rounded-lg bg-sky-400/10 text-sky-400 border border-sky-400/20 hover:bg-sky-400/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
                            Move to Campaign
                        </button>
                        <button className="text-xs font-medium px-3 py-1.5 rounded-lg bg-[var(--red-glow)] text-[var(--red)] border border-[var(--border-red)] hover:bg-[var(--red-glow)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]">
                            Delete Selected
                        </button>
                        <button
                            onClick={handleEnrich}
                            disabled={enriching}
                            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-400/10 text-emerald-400 border border-emerald-400/20 hover:bg-emerald-400/20 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                        >
                            {enriching ? "Enriching..." : "Enrich Selected"}
                        </button>
                        <button className="text-xs font-medium px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]">
                            Export CSV
                        </button>
                        <button
                            onClick={() => setSelectedIds(new Set())}
                            className="ml-auto text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors focus-visible:outline-none"
                            aria-label="Clear selection"
                        >
                            ✕ Clear
                        </button>
                    </div>
                )}

                {/* ── Table ── */}
                <div className="flex-1 overflow-auto">
                    {error ? (
                        <div className="flex items-center justify-center py-20">
                            <div className="flex flex-col items-center gap-3 text-center">
                                <div className="w-12 h-12 rounded-full bg-[var(--red-glow)] flex items-center justify-center text-[var(--red)]">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                                        <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                                    </svg>
                                </div>
                                <p className="text-sm font-medium text-[var(--text-secondary)]">{error}</p>
                                <button onClick={loadLeads} className="text-xs text-[var(--red)] hover:underline focus-visible:outline-none focus-visible:underline">Retry</button>
                            </div>
                        </div>
                    ) : (
                        <table className="w-full text-left" aria-label="Leads table">
                            <thead className="sticky top-0 z-10 bg-[var(--navy-mid)] border-b border-[var(--border)]">
                                <tr>
                                    <th scope="col" className="px-4 py-3 w-8">
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.size === sorted.length && sorted.length > 0}
                                            onChange={selectAll}
                                            aria-label="Select all leads"
                                            className="accent-[var(--red)] cursor-pointer"
                                        />
                                    </th>
                                    <th scope="col" className="px-2 py-3 w-8" aria-label="Expand row" />
                                    <th scope="col" className="px-4 py-3">
                                        <SortButton field="companyName" label="Lead" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                                    </th>
                                    <th scope="col" className="px-4 py-3 hidden md:table-cell">
                                        <span className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">Campaign</span>
                                    </th>
                                    <th scope="col" className="px-4 py-3">
                                        <SortButton field="qualificationScore" label="Score" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                                    </th>
                                    <th scope="col" className="px-4 py-3">
                                        <span className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">Action</span>
                                    </th>
                                    <th scope="col" className="px-4 py-3 hidden lg:table-cell">
                                        <span className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">Pipeline</span>
                                    </th>
                                    <th scope="col" className="px-4 py-3 hidden xl:table-cell">
                                        <span className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">Signals</span>
                                    </th>
                                    <th scope="col" className="px-4 py-3 text-center hidden lg:table-cell">
                                        <span className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">Msg</span>
                                    </th>
                                    <th scope="col" className="px-4 py-3 text-center hidden lg:table-cell">
                                        <span className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">Rep</span>
                                    </th>
                                    <th scope="col" className="px-4 py-3 hidden xl:table-cell">
                                        <SortButton field="createdAt" label="Added" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                                    </th>
                                    <th scope="col" className="px-4 py-3 w-16" aria-label="Row actions" />
                                </tr>
                            </thead>
                            <tbody>
                                {loading
                                    ? [...Array(8)].map((_, i) => <SkeletonRow key={i} />)
                                    : sorted.length === 0
                                        ? <tr><td colSpan={12}><EmptyState hasFilters={hasFilters} /></td></tr>
                                        : sorted.map((lead) => {
                                            const isSelected = selectedIds.has(lead.id);
                                            const name = lead.firstName ? `${lead.firstName} ${lead.lastName ?? ""}`.trim() : null;
                                            const initial = (lead.firstName?.[0] ?? lead.companyName[0]).toUpperCase();
                                            const actionCfg = lead.recommendedAction ? ACTION_CFG[lead.recommendedAction] : null;

                                            return (
                                                <React.Fragment key={lead.id}>
                                                    <tr className={`group border-b border-[var(--border)] transition-colors duration-100 ${isSelected ? "bg-sky-400/5" : "hover:bg-[var(--surface-2)]"}`}>
                                                        {/* Checkbox */}
                                                        <td className="px-4 py-3">
                                                            <input
                                                                type="checkbox"
                                                                checked={isSelected}
                                                                onChange={() => toggleSelect(lead.id)}
                                                                aria-label={`Select ${lead.companyName}`}
                                                                className="accent-[var(--red)] cursor-pointer"
                                                            />
                                                        </td>
                                                        {/* Open detail modal */}
                                                        <td className="px-2 py-3">
                                                            <button
                                                                onClick={() => setDetailLead(lead)}
                                                                aria-label={`View details for ${lead.companyName}`}
                                                                className="flex items-center justify-center w-6 h-6 rounded text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                                                            >
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                                    <polyline points="9 18 15 12 9 6" />
                                                                </svg>
                                                            </button>
                                                        </td>
                                                        {/* Lead identity */}
                                                        <td className="px-4 py-3">
                                                            <div className="flex items-center gap-3">
                                                                <div
                                                                    className="w-8 h-8 rounded-full border border-[var(--border)] flex items-center justify-center text-xs font-bold flex-shrink-0 select-none"
                                                                    style={{
                                                                        background: actionCfg
                                                                            ? undefined
                                                                            : "linear-gradient(135deg, var(--navy-deep), var(--surface-2))",
                                                                    }}
                                                                    aria-hidden="true"
                                                                >
                                                                    {actionCfg ? (
                                                                        <span className={`${actionCfg.className.match(/text-[^\s]+/)?.[0] ?? "text-[var(--text-secondary)]"}`}>{initial}</span>
                                                                    ) : (
                                                                        <span className="text-[var(--text-secondary)]">{initial}</span>
                                                                    )}
                                                                </div>
                                                                <div className="min-w-0">
                                                                    {name && <p className="text-sm font-medium text-[var(--text-primary)] truncate leading-none mb-0.5">{name}</p>}
                                                                    <p className={`truncate ${name ? "text-xs text-[var(--text-muted)]" : "text-sm font-medium text-[var(--text-primary)]"}`}>{lead.companyName}</p>
                                                                    {lead.title && <p className="text-xs text-[var(--text-muted)] truncate">{lead.title}</p>}
                                                                    {lead.competitorSignal && (
                                                                        <div className="mt-1">
                                                                            <CompetitorBadge tech={lead.competitorTech ?? []} />
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </td>
                                                        {/* Campaign */}
                                                        <td className="px-4 py-3 max-w-[160px] hidden md:table-cell">
                                                            <Link href={`/dashboard/campaigns/${lead.campaign.id}`} className="group/link flex items-center gap-1.5 min-w-0" title={lead.campaign.name}>
                                                                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[lead.campaign.status] ?? "bg-[var(--text-muted)]"}`} aria-hidden="true" />
                                                                <span className="text-xs text-[var(--text-secondary)] truncate group-hover/link:text-[var(--red)] transition-colors duration-150">
                                                                    {lead.campaign.name}
                                                                </span>
                                                            </Link>
                                                        </td>
                                                        {/* Score */}
                                                        <td className="px-4 py-3">
                                                            {lead.qualificationScore != null
                                                                ? <ScoreBar score={lead.qualificationScore} />
                                                                : <span className="text-xs text-[var(--text-muted)]">—</span>}
                                                        </td>
                                                        {/* Action badge */}
                                                        <td className="px-4 py-3">
                                                            {lead.recommendedAction
                                                                ? <ActionBadge action={lead.recommendedAction} />
                                                                : <span className="text-xs text-[var(--text-muted)]">—</span>}
                                                        </td>
                                                        {/* Pipeline */}
                                                        <td className="px-4 py-3 hidden lg:table-cell">
                                                            {lead.pipelineStage
                                                                ? <PipelinePill stage={lead.pipelineStage} />
                                                                : <span className="text-xs text-[var(--text-muted)]">—</span>}
                                                        </td>
                                                        {/* Signals */}
                                                        <td className="px-4 py-3 hidden xl:table-cell">
                                                            <div className="flex flex-wrap gap-1">
                                                                {lead.signals.slice(0, 2).map((s) => (
                                                                    <SignalTag key={s.id} type={s.type} signalType={s.signalType} />
                                                                ))}
                                                                {lead.signals.length > 2 && (
                                                                    <span className="text-xs text-[var(--text-muted)]">+{lead.signals.length - 2}</span>
                                                                )}
                                                                {lead.signals.length === 0 && <span className="text-xs text-[var(--text-muted)]">—</span>}
                                                            </div>
                                                        </td>
                                                        {/* Messages */}
                                                        <td className="px-4 py-3 text-center hidden lg:table-cell">
                                                            <span className="text-sm text-[var(--text-secondary)] tabular-nums">{lead._count.outreachMessages}</span>
                                                        </td>
                                                        {/* Replies */}
                                                        <td className="px-4 py-3 text-center hidden lg:table-cell">
                                                            <span className={`text-sm tabular-nums font-medium ${lead._count.replies > 0 ? "text-emerald-400" : "text-[var(--text-muted)]"}`}>
                                                                {lead._count.replies}
                                                            </span>
                                                        </td>
                                                        {/* Added date */}
                                                        <td className="px-4 py-3 text-xs text-[var(--text-muted)] tabular-nums whitespace-nowrap hidden xl:table-cell">
                                                            {new Date(lead.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                                                        </td>
                                                        {/* Row actions */}
                                                        <td className="px-4 py-3">
                                                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                                                                <Link
                                                                    href={`/dashboard/campaigns/${lead.campaign.id}?tab=leads&lead=${lead.id}`}
                                                                    aria-label={`View ${lead.companyName} in campaign`}
                                                                    className="flex items-center justify-center w-7 h-7 rounded-md text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-2)] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                                                                >
                                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                                                        <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                                                                    </svg>
                                                                </Link>
                                                                <button
                                                                    onClick={() => setDeleteTarget(lead)}
                                                                    aria-label={`Delete ${lead.companyName}`}
                                                                    className="flex items-center justify-center w-7 h-7 rounded-md text-[var(--text-muted)] hover:text-[var(--red)] hover:bg-[var(--red-glow)] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                                                                >
                                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                                        <polyline points="3 6 5 6 21 6" />
                                                                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                                                        <path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                                                                    </svg>
                                                                </button>
                                                            </div>
                                                        </td>
                                                </tr>
                                                </React.Fragment>
                                            );
                                        })}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* ── Pagination ── */}
                {!loading && meta.totalPages > 1 && (
                    <div className="flex items-center justify-between px-6 py-3 border-t border-[var(--border)] bg-[var(--navy-mid)] flex-shrink-0">
                        <span className="text-xs text-[var(--text-muted)] tabular-nums">
                            Page {meta.page} of {meta.totalPages} · {meta.total.toLocaleString()} leads
                        </span>
                        <div className="flex items-center gap-1" role="navigation" aria-label="Pagination">
                            <button
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                disabled={page === 1}
                                className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] text-[var(--text-secondary)] disabled:opacity-40 hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                                aria-label="Previous page"
                            >
                                ← Prev
                            </button>
                            {Array.from({ length: Math.min(meta.totalPages, 5) }, (_, i) => {
                                const p = i + 1;
                                return (
                                    <button
                                        key={p}
                                        onClick={() => setPage(p)}
                                        aria-label={`Page ${p}`}
                                        aria-current={page === p ? "page" : undefined}
                                        className={[
                                            "w-8 h-8 text-xs rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]",
                                            page === p
                                                ? "bg-[var(--red-glow)] text-[var(--red)] border border-[var(--border-red)] font-medium"
                                                : "border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-2)]",
                                        ].join(" ")}
                                    >
                                        {p}
                                    </button>
                                );
                            })}
                            <button
                                onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
                                disabled={page === meta.totalPages}
                                className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] text-[var(--text-secondary)] disabled:opacity-40 hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                                aria-label="Next page"
                            >
                                Next →
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* ── Modals ── */}
            {detailLead && (
                <LeadDetailModal
                    lead={detailLead}
                    onClose={() => setDetailLead(null)}
                    onSaved={() => { loadLeads(); }}
                />
            )}
            {deleteTarget && (
                <DeleteModal
                    lead={deleteTarget}
                    onConfirm={handleDelete}
                    onCancel={() => setDeleteTarget(null)}
                    isDeleting={isDeleting}
                />
            )}
            {showAddSheet && (
                <AddLeadSheet
                    campaigns={campaigns}
                    onClose={() => setShowAddSheet(false)}
                    onSaved={() => { setShowAddSheet(false); loadLeads(); }}
                />
            )}
            {showCsvImport && (
                <CsvImportModal
                    campaigns={campaigns}
                    defaultCampaignId={activeCampaignId}
                    onClose={() => setShowCsvImport(false)}
                    onImported={() => { setShowCsvImport(false); loadLeads(); }}
                />
            )}

            {toast && (
                <div className="fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl bg-[var(--surface)] border border-[var(--border)] shadow-2xl flex items-center gap-2 text-sm text-[var(--text-primary)] animate-in fade-in slide-in-from-bottom-5 duration-300">
                    <span className="text-emerald-400 font-bold">✓</span>
                    <span>{toast}</span>
                    <button onClick={() => setToast(null)} className="ml-2 text-[var(--text-muted)] hover:text-[var(--text-primary)]">✕</button>
                </div>
            )}
        </>
    );
}