"use client";

import React, { useState, useEffect, useCallback, Fragment, useRef } from "react";
import Link from "next/link";
import { ScoreIndicator } from "@/app/components/ui/ScoreIndicator";
import { SignalBadge } from "@/app/components/ui/Badge";
import { useToast } from "@/app/hooks/useToast";
import { ToastRegion } from "@/app/components/dashboard/ToastRegion";

interface Signal {
    id: string;
    type?: string;
    signalType?: string;
    value: string;
    confidence: number;
}

interface ScoreBreakdown {
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
    qualificationScore: number | null;
    qualificationReason: string | null;
    breakdownScores: ScoreBreakdown | null;
    recommendedAction: string | null;
    pipelineStage: string | null;
    competitorSignal: boolean;
    competitorTech: string[];
    signals: Signal[];
    _count: { outreachMessages: number; replies: number };
    createdAt: string;
    enrichmentData: any;
    lastEnrichedAt: string | null;
    emailVerified?: boolean;
    outreachMessages?: Array<{
        id: string;
        approvalStatus: string;
        deliveryState: string;
        sentAt: string | null;
    }>;
    stepStatuses?: Array<{
        id: string;
        status: string;
    }>;
}

interface LeadsMeta {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

interface Campaign {
    id: string;
    status: string;
    icpDescription?: string | null;
    senderDomain?: string | null;
    senderMailboxId?: string | null;
    linkedInAccountId?: string | null;
}

interface OutreachMessage {
    id: string;
    subject: string;
    body: string;
    approvalStatus: "PENDING" | "APPROVED" | "REJECTED";
    channel?: string | null;
    sentAt?: string | null;
}

type BulkAction = "suppress" | "rescore" | "score-and-enrich" | "sequence/enroll" | "sequence/send-email" | "stage";


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


const BREAKDOWN_METRICS: { key: keyof ScoreBreakdown; label: string; color: string }[] = [
    { key: "icpMatch", label: "ICP Match", color: "bg-violet-400" },
    { key: "intentStrength", label: "Intent", color: "bg-sky-400" },
    { key: "fundingSignals", label: "Funding", color: "bg-emerald-400" },
    { key: "hiringVelocity", label: "Hiring", color: "bg-orange-400" },
    { key: "techFit", label: "Tech Fit", color: "bg-cyan-400" },
    { key: "recency", label: "Recency", color: "bg-amber-400" },
];

function ScoreBreakdownGrid({ breakdown }: { breakdown: ScoreBreakdown }) {
    return (
        <div className="space-y-1.5">
            {BREAKDOWN_METRICS.map(({ key, label, color }) => {
                const raw = breakdown[key] ?? 0;
                const pct = raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
                const textCls = pct >= 75 ? "text-emerald-400" : pct >= 50 ? "text-amber-400" : "text-[var(--red-text)]";
                return (
                    <div key={key} className="flex items-center gap-2">
                        <span className="text-[10px] text-[var(--text-muted)] w-16 flex-shrink-0 text-right">{label}</span>
                        <div className="flex-1 h-1.5 bg-[var(--surface)] rounded-full overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-[width] duration-500 ease-out ${color}`}
                                style={{ width: `${pct}%` }}
                                role="progressbar" aria-valuenow={pct} aria-valuemax={100} aria-label={label}
                            />
                        </div>
                        <span className={`text-[10px] font-semibold tabular-nums w-7 text-right flex-shrink-0 ${textCls}`}>{pct}</span>
                    </div>
                );
            })}
        </div>
    );
}

function SetupChecklist({
    isOpen,
    onClose,
    campaignId,
    isIcpDone,
    isSenderDone,
    isDiscoveryDone,
    isDiscovering,
    onDiscover,
}: {
    isOpen: boolean;
    onClose: () => void;
    campaignId: string;
    isIcpDone: boolean;
    isSenderDone: boolean;
    isDiscoveryDone: boolean;
    isDiscovering: boolean;
    onDiscover: () => void;
}) {
    const [activeStep, setActiveStep] = useState<number | null>(
        !isIcpDone ? 0 : !isSenderDone ? 1 : !isDiscoveryDone ? 2 : null
    );
    const stepsComplete = [isIcpDone, isSenderDone, isDiscoveryDone].filter(Boolean).length;
    const totalSteps = 3;
    const progressPct = Math.round((stepsComplete / totalSteps) * 100);

    const steps = [
        {
            label: "Define your ICP",
            description: "Set targeting criteria so ScoutSend knows exactly which companies and roles to prospect.",
            done: isIcpDone,
            cta: (
                <Link
                    href={`/dashboard/campaigns/${campaignId}/edit`}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-[var(--red)] text-white hover:bg-[var(--red-dim)] transition-all"
                >
                    Configure ICP
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
                </Link>
            ),
        },
        {
            label: "Link a sending channel",
            description: "Connect an email mailbox or LinkedIn account to send personalized outreach at scale.",
            done: isSenderDone,
            cta: (
                <Link
                    href={`/dashboard/campaigns/${campaignId}/edit`}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-[var(--red)] text-white hover:bg-[var(--red-dim)] transition-all"
                >
                    Link Channel
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
                </Link>
            ),
        },
        {
            label: "Discover leads",
            description: "Trigger AI-powered prospect discovery and pipeline scoring based on your ICP.",
            done: isDiscoveryDone,
            cta: (
                <button
                    id="btn-checklist-discover"
                    onClick={onDiscover}
                    disabled={isDiscovering}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-[var(--red)] text-white hover:bg-[var(--red-dim)] transition-all disabled:opacity-50"
                >
                    {isDiscovering ? (
                        <svg className="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                    ) : (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
                    )}
                    {isDiscovering ? "Queuing…" : "Start Discovery"}
                </button>
            ),
        },
    ];

    return (
        <>
            <div
                className={`fixed inset-0 z-30 transition-opacity duration-200 ${isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
                onClick={onClose}
                aria-hidden="true"
            />
            <aside
                role="complementary"
                aria-label="Campaign setup checklist"
                className={`fixed top-0 right-0 h-screen z-40 w-[360px] bg-[var(--navy-mid)] border-l border-[var(--border)] shadow-2xl flex flex-col transition-transform duration-200 ease-out ${isOpen ? "translate-x-0" : "translate-x-full"
                    }`}
            >
                <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] flex-shrink-0">
                    <div>
                        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Campaign Setup</h2>
                        <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{stepsComplete} of {totalSteps} steps complete</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                        aria-label="Close setup panel"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                </div>

                <div className="px-5 py-3 border-b border-[var(--border)] flex-shrink-0">
                    <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Progress</span>
                        <span className="text-[10px] font-bold tabular-nums text-[var(--text-secondary)]">{progressPct}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-[var(--surface-2)] rounded-full overflow-hidden">
                        <div
                            className="h-full rounded-full bg-gradient-to-r from-[var(--red)] to-orange-400 transition-[width] duration-500 ease-out"
                            style={{ width: `${progressPct}%` }}
                            role="progressbar" aria-valuenow={progressPct} aria-valuemax={100} aria-label="Setup progress"
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                    {steps.map((step, idx) => {
                        const isActive = activeStep === idx;
                        const isUpcoming = !step.done && idx > (steps.findIndex(s => !s.done));
                        return (
                            <div
                                key={idx}
                                className={`rounded-xl border transition-all duration-150 overflow-hidden ${step.done
                                        ? "border-emerald-400/20 bg-emerald-400/5"
                                        : isActive
                                            ? "border-[var(--border-red)]/40 bg-[var(--red-glow)]"
                                            : "border-[var(--border)] bg-[var(--surface)]"
                                    }`}
                            >
                                <button
                                    className="w-full flex items-center gap-3 px-4 py-3 text-left"
                                    onClick={() => setActiveStep(isActive ? null : idx)}
                                    aria-expanded={isActive}
                                >
                                    <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-bold border ${step.done
                                            ? "bg-emerald-400/20 text-emerald-400 border-emerald-400/30"
                                            : isActive
                                                ? "bg-[var(--red-glow)] text-[var(--red-text)] border-[var(--border-red)]/40"
                                                : "bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]"
                                        }`}>
                                        {step.done ? (
                                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                                        ) : (idx + 1)}
                                    </div>
                                    <span className={`text-xs font-semibold flex-1 min-w-0 ${step.done ? "text-[var(--text-muted)] line-through" : "text-[var(--text-primary)]"
                                        }`}>
                                        {step.label}
                                    </span>
                                    {!step.done && (
                                        <svg
                                            className={`text-[var(--text-muted)] flex-shrink-0 transition-transform duration-150 ${isActive ? "rotate-180" : ""}`}
                                            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                                        >
                                            <polyline points="6 9 12 15 18 9" />
                                        </svg>
                                    )}
                                </button>

                                {isActive && !step.done && (
                                    <div className="px-4 pb-4 space-y-3 border-t border-[var(--border-red)]/20">
                                        <p className="text-[11px] text-[var(--text-muted)] leading-relaxed pt-3">{step.description}</p>
                                        {step.cta}
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {stepsComplete === totalSteps && (
                        <div className="flex flex-col items-center gap-2 py-6 text-center">
                            <div className="w-10 h-10 rounded-full bg-emerald-400/10 border border-emerald-400/20 flex items-center justify-center text-emerald-400">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                            </div>
                            <p className="text-xs font-semibold text-emerald-400">All steps complete</p>
                            <p className="text-[11px] text-[var(--text-muted)]">Your campaign is fully configured and running.</p>
                        </div>
                    )}
                </div>
            </aside>
        </>
    );
}

function LeadDetailModal({ lead, onClose, onRefresh }: { lead: Lead; onClose: () => void; onRefresh?: () => void }) {
    const [msg, setMsg] = useState<OutreachMessage | null>(null);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [editing, setEditing] = useState(false);
    const [editedSubject, setEditedSubject] = useState("");
    const [editedBody, setEditedBody] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedTone, setSelectedTone] = useState<"Professional" | "Casual" | "Direct">("Professional");

    useEffect(() => {
        setEditing(false);
        setGenerating(false);
        setError(null);
    }, [lead.id]);

    const loadMessage = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/outreach-messages?leadId=${lead.id}`);
            if (!res.ok) throw new Error("Failed to fetch messages");
            const data = await res.json();
            if (data.data && data.data.length > 0) {
                const message = data.data[0];
                setMsg(message);
                setEditedSubject(message.subject);
                setEditedBody(message.body);
            } else {
                setMsg(null);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Error loading message");
        } finally {
            setLoading(false);
        }
    }, [lead.id]);

    useEffect(() => {
        loadMessage();
    }, [loadMessage]);

    async function handleGenerate() {
        if (generating) return;
        setGenerating(true);
        setError(null);
        try {
            const res = await fetch(`/api/leads/${lead.id}/generate-message`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tone: selectedTone }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error ?? "Failed to generate message");
            }
            const data = await res.json();
            setMsg(data);
            setEditedSubject(data.subject);
            setEditedBody(data.body);
            if (onRefresh) onRefresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Generation failed");
        } finally {
            setGenerating(false);
        }
    }

    async function handleSaveAndApprove() {
        if (!msg) return;
        setSaving(true);
        try {
            const isDirty = editedSubject !== msg.subject || editedBody !== msg.body;
            if (isDirty) {
                const res = await fetch(`/api/outreach-messages/${msg.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ subject: editedSubject, body: editedBody }),
                });
                if (!res.ok) throw new Error("Failed to save changes");
            }
            const appRes = await fetch(`/api/outreach-messages/${msg.id}/approve`, {
                method: "POST",
            });
            if (!appRes.ok) throw new Error("Failed to approve message");

            setEditing(false);
            await loadMessage();
            if (onRefresh) onRefresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Action failed");
        } finally {
            setSaving(false);
        }
    }

    async function handleReject() {
        if (!msg) return;
        setSaving(true);
        try {
            const res = await fetch(`/api/outreach-messages/${msg.id}/reject`, {
                method: "POST",
            });
            if (!res.ok) throw new Error("Failed to reject message");
            await loadMessage();
            if (onRefresh) onRefresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Rejection failed");
        } finally {
            setSaving(false);
        }
    }

    const name = lead.firstName ? `${lead.firstName} ${lead.lastName ?? ""}`.trim() : null;
    const initial = (lead.firstName?.[0] ?? lead.companyName[0]).toUpperCase();

    return (
        <div
            className="w-full md:w-[480px] lg:w-[600px] border-l border-[var(--border)] bg-[var(--surface)] shadow-2xl h-screen fixed right-0 top-0 z-50 flex flex-col overflow-hidden animate-in slide-in-from-right duration-200"
            role="dialog"
            aria-labelledby="lead-detail-modal-title"
        >
            <div className="flex items-center gap-4 px-6 pt-5 pb-4 border-b border-[var(--border)] flex-shrink-0 bg-[var(--navy-mid)]">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--navy-deep)] to-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center font-bold text-[var(--text-secondary)] flex-shrink-0 select-none">
                    {initial}
                </div>
                <div className="flex-1 min-w-0">
                    <h2 id="lead-detail-modal-title" className="text-base font-bold text-[var(--text-primary)] truncate leading-none mb-1">
                        {name ?? lead.companyName}
                    </h2>
                    <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] truncate">
                        {name && <span>{lead.companyName}</span>}
                        {name && lead.title && <span>&middot;</span>}
                        {lead.title && <span>{lead.title}</span>}
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className="flex items-center justify-center w-8 h-8 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    aria-label="Close details"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                </button>
            </div>

            <div className="flex-1 flex flex-col divide-y divide-[var(--border)] overflow-y-auto bg-[var(--surface)]">
                <div className="p-6 space-y-6 bg-[var(--surface-2)]/20">
                    <div>
                        <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-3">Score Breakdown</p>
                        {lead.breakdownScores ? (
                            <ScoreBreakdownGrid breakdown={lead.breakdownScores} />
                        ) : (
                            <p className="text-xs text-[var(--text-muted)]">No breakdown available</p>
                        )}
                    </div>

                    <div>
                        <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-3">Signals ({lead.signals.length})</p>
                        <div className="space-y-2.5">
                            {lead.signals.map((sig) => {
                                const rawType = sig.signalType ?? sig.type ?? "";
                                const cfg = SIGNAL_COLORS[rawType] ?? SIGNAL_COLORS.CONTENT;
                                return (
                                    <div key={sig.id} className="flex items-start gap-3">
                                        <span className={`flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>{rawType.replace(/_/g, " ")}</span>
                                        <span className="text-xs text-[var(--text-secondary)] flex-1 leading-normal">{sig.value}</span>
                                        <span className="text-xs text-[var(--text-muted)] tabular-nums flex-shrink-0">{(sig.confidence * 100).toFixed(0)}%</span>
                                    </div>
                                );
                            })}
                            {lead.signals.length === 0 && <p className="text-xs text-[var(--text-muted)]">No signals recorded</p>}
                        </div>
                    </div>

                    <div>
                        <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-2">Qualification Reason</p>
                        <p className="text-xs text-[var(--text-secondary)] leading-relaxed bg-[var(--surface)] p-3 rounded-lg border border-[var(--border)]">
                            {lead.qualificationReason ?? "—"}
                        </p>
                        {lead.website && (
                            <a href={`https://${lead.website}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-sky-400 hover:underline mt-3 focus-visible:outline-none">
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                    <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                                </svg>
                                Visit website
                            </a>
                        )}
                    </div>
                </div>

                <div className="p-6 flex flex-col min-h-0 bg-[var(--surface)]">
                    <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-3 flex-shrink-0">Outreach Message Draft</p>

                    {error && <p className="text-xs text-[var(--red-text)] mb-3 bg-[var(--red-glow)] border border-[var(--border-red)] px-3 py-2 rounded-lg">{error}</p>}

                    <div className="flex-1 flex flex-col min-h-0 justify-center">
                        {loading ? (
                            <div className="flex items-center justify-center gap-2 text-xs text-[var(--text-muted)] py-12">
                                <svg className="animate-spin text-[var(--text-muted)]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                                Checking message status...
                            </div>
                        ) : msg ? (
                            <div className="flex-1 flex flex-col min-h-0 bg-[var(--surface-2)]/30 border border-[var(--border)] rounded-xl p-4">
                                <div className="flex items-center justify-between border-b border-[var(--border)] pb-2 mb-3 flex-shrink-0">
                                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${msg.approvalStatus === "APPROVED" ? "bg-emerald-500/10 text-emerald-400" :
                                            msg.approvalStatus === "REJECTED" ? "bg-[var(--red-glow)] text-[var(--red-text)]" : "bg-amber-400/10 text-amber-400"
                                        }`}>
                                        {msg.approvalStatus}
                                    </span>
                                    {msg.approvalStatus === "PENDING" && !editing && (
                                        <button
                                            onClick={() => setEditing(true)}
                                            className="text-xs text-sky-400 hover:underline font-medium focus-visible:outline-none"
                                        >
                                            Edit Draft
                                        </button>
                                    )}
                                </div>

                                {editing ? (
                                    <div className="flex-1 flex flex-col gap-3 min-h-0">
                                        <div className="flex flex-col gap-1 flex-shrink-0">
                                            <label className="text-[9px] text-[var(--text-muted)] uppercase font-bold">Subject</label>
                                            <input
                                                type="text"
                                                value={editedSubject}
                                                onChange={(e) => setEditedSubject(e.target.value)}
                                                className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--red)] transition-colors"
                                            />
                                        </div>
                                        <div className="flex-1 flex flex-col gap-1 min-h-0">
                                            <label className="text-[9px] text-[var(--text-muted)] uppercase font-bold flex-shrink-0">Body</label>
                                            <textarea
                                                value={editedBody}
                                                onChange={(e) => setEditedBody(e.target.value)}
                                                rows={8}
                                                className="flex-1 w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--red)] resize-none font-sans leading-relaxed overflow-y-auto"
                                            />
                                        </div>
                                        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border)] flex-shrink-0">
                                            <button
                                                disabled={saving}
                                                onClick={() => { setEditing(false); setEditedSubject(msg.subject); setEditedBody(msg.body); }}
                                                className="text-xs px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                disabled={saving}
                                                onClick={handleSaveAndApprove}
                                                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white active:scale-[0.97] transition-all focus-visible:outline-none"
                                            >
                                                {saving ? "Saving..." : "Save & Approve"}
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex-1 flex flex-col min-h-0">
                                        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                                            <p className="text-xs font-bold text-[var(--text-primary)]">Subject: {msg.subject}</p>
                                            <p className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed font-sans">{msg.body}</p>
                                        </div>

                                        {msg.approvalStatus === "PENDING" && (
                                            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)] flex-shrink-0">
                                                <button
                                                    disabled={saving}
                                                    onClick={handleReject}
                                                    className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--red-text)] hover:border-[var(--border-red)] hover:bg-[var(--red-glow)] transition-colors focus-visible:outline-none"
                                                >
                                                    Reject
                                                </button>
                                                <button
                                                    disabled={saving}
                                                    onClick={handleSaveAndApprove}
                                                    className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white active:scale-[0.97] transition-all focus-visible:outline-none"
                                                >
                                                    Approve Message
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center text-center gap-4 py-12 border border-dashed border-[var(--border)] rounded-xl bg-[var(--surface-2)]/10">
                                <p className="text-xs text-[var(--text-muted)] max-w-xs leading-normal">No message draft has been generated for this lead yet.</p>
                                <div className="flex flex-col gap-2 items-center">
                                    <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--text-muted)]">Select AI Tone</span>
                                    <div className="flex items-center gap-1.5">
                                        {(["Professional", "Casual", "Direct"] as const).map((t) => (
                                            <button
                                                key={t}
                                                type="button"
                                                onClick={() => setSelectedTone(t)}
                                                className={`px-3 py-1 text-xs font-semibold rounded-full border transition-all duration-150 cursor-pointer ${selectedTone === t
                                                        ? "bg-[var(--red-glow)] text-[var(--red-text)] border-[var(--border-red)]/20 font-bold"
                                                        : "bg-[var(--surface)] text-[var(--text-secondary)] border-[var(--border)] hover:border-[var(--text-muted)]"
                                                    }`}
                                            >
                                                {t}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <button
                                    onClick={handleGenerate}
                                    disabled={generating}
                                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg bg-[var(--red)] hover:bg-[var(--red-dim)] text-white active:scale-[0.97] transition-all duration-150 disabled:opacity-50 focus-visible:outline-none"
                                >
                                    {generating ? (
                                        <>
                                            <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                                            Generating...
                                        </>
                                    ) : "✨ Generate Message Draft"}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

interface BulkActionBarProps {
    count: number;
    campaignId: string;
    selectedIds: string[];
    selectedLeads: Lead[];
    onClear: () => void;
    onDone: () => void;
}

function BulkActionBar({ count, campaignId, selectedIds, selectedLeads, onClear, onDone }: BulkActionBarProps) {
    const [busy, setBusy] = useState<BulkAction | null>(null);
    const [result, setResult] = useState<string | null>(null);
    const [stageOpen, setStageOpen] = useState(false);
    const stageRef = useRef<HTMLDivElement>(null);

    const STAGE_OPTIONS: { value: string; label: string; color: string }[] = [
        { value: "PROSPECT", label: "Prospect", color: "text-[var(--text-secondary)]" },
        { value: "ENGAGED", label: "Engaged", color: "text-indigo-400" },
        { value: "HOT", label: "Hot", color: "text-orange-400" },
        { value: "MEETING_BOOKED", label: "Meeting Booked", color: "text-emerald-400" },
        { value: "DISQUALIFIED", label: "Disqualified", color: "text-[var(--red-text)]" },
    ];

    useEffect(() => {
        if (!stageOpen) return;
        function handleOutside(e: MouseEvent) {
            if (stageRef.current && !stageRef.current.contains(e.target as Node)) setStageOpen(false);
        }
        document.addEventListener("mousedown", handleOutside);
        return () => document.removeEventListener("mousedown", handleOutside);
    }, [stageOpen]);

    async function runAction(action: BulkAction, extra?: Record<string, unknown>) {
        setBusy(action);
        setResult(null);
        try {
            const res = await fetch(`/api/leads/bulk/${action}`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ campaignId, leadIds: selectedIds, ...extra }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
            let msgText = "";
            if (action === "suppress") msgText = `${data.deleted ?? selectedIds.length} leads suppressed`;
            else if (action === "rescore") msgText = `${data.queued ?? selectedIds.length} leads queued for re-scoring`;
            else if (action === "score-and-enrich") msgText = `${data.qualified ?? 0} qualified · ${data.disqualified ?? 0} disqualified${data.enrichmentQueued ? ` · ${data.enrichmentQueued} queued for enrichment` : ""}`;
            else if (action === "sequence/enroll") msgText = `${data.enrolled ?? selectedIds.length} leads added to sequence`;
            else if (action === "sequence/send-email") msgText = `${data.succeeded?.length ?? 0} emails approved & queued`;
            else if (action === "stage") msgText = `${data.updated ?? selectedIds.length} stages updated`;

            setResult(msgText);
            setTimeout(() => { setResult(null); onDone(); }, 2500);
        } catch (err) {
            setResult(err instanceof Error ? err.message : "Action failed");
            setTimeout(() => setResult(null), 4000);
        } finally {
            setBusy(null);
        }
    }

    function handleExportCsv() {
        const header = ["First Name", "Last Name", "Email", "Company", "Title", "Website", "Status", "Score"];
        const rows = selectedLeads.map((l) => [
            l.firstName ?? "",
            l.lastName ?? "",
            l.email ?? "",
            l.companyName ?? "",
            l.title ?? "",
            l.website ?? "",
            l.pipelineStage ?? "",
            l.qualificationScore != null
                ? String(Math.round(l.qualificationScore <= 1 ? l.qualificationScore * 100 : l.qualificationScore))
                : "",
        ].map((v) => `"${String(v).replace(/"/g, '""')}"`));
        const csv = [header.map((h) => `"${h}"`).join(","), ...rows.map((r) => r.join(","))].join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `leads-export-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    return (
        <div className="flex items-center gap-3 px-6 py-3 bg-[var(--navy-deep)] border-b border-[var(--border-red)] flex-shrink-0">
            <span className="text-xs font-semibold text-[var(--red-text)] tabular-nums">{count} selected</span>
            {result && <span className="text-xs text-emerald-400 font-medium">{result}</span>}
            <div className="flex items-center gap-2 ml-auto">
                <button
                    id="btn-bulk-score-and-enrich"
                    onClick={() => runAction("score-and-enrich")}
                    disabled={!!busy}
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-400 hover:bg-sky-500/20 disabled:opacity-50 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                >
                    {busy === "score-and-enrich" ? (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                    ) : (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                    )}
                    Score & Research
                </button>
                <button
                    onClick={() => runAction("rescore")}
                    disabled={!!busy}
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-violet-500/10 border border-violet-500/30 text-violet-400 hover:bg-violet-500/20 disabled:opacity-50 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                >
                    {busy === "rescore" ? (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                    ) : (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 .49-4.5" /></svg>
                    )}
                    Re-score
                </button>

                <button
                    onClick={() => runAction("sequence/enroll")}
                    disabled={!!busy}
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/20 disabled:opacity-50 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                >
                    {busy === "sequence/enroll" ? (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                    ) : (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
                    )}
                    Add to Sequence
                </button>
                <button
                    onClick={() => runAction("sequence/send-email")}
                    disabled={!!busy}
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                >
                    {busy === "sequence/send-email" ? (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                    ) : (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
                    )}
                    Send Email Batch
                </button>

                <div ref={stageRef} className="relative">
                    <button
                        onClick={() => setStageOpen((o) => !o)}
                        disabled={!!busy}
                        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-400 hover:bg-sky-500/20 disabled:opacity-50 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                        aria-haspopup="listbox"
                        aria-expanded={stageOpen}
                    >
                        {busy === "stage" ? (
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                        ) : (
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" /></svg>
                        )}
                        Move Stage
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
                    </button>
                    {stageOpen && (
                        <div className="absolute right-0 mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-xl py-1 z-30 w-44" role="listbox" aria-label="Select pipeline stage">
                            {STAGE_OPTIONS.map((opt) => (
                                <button
                                    key={opt.value}
                                    role="option"
                                    onClick={() => { setStageOpen(false); runAction("stage", { pipelineStage: opt.value }); }}
                                    className={`w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-[var(--surface-2)] flex items-center gap-2 ${opt.color}`}
                                >
                                    <span className="w-1.5 h-1.5 rounded-full bg-current flex-shrink-0" aria-hidden="true" />
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <button
                    onClick={handleExportCsv}
                    disabled={!!busy}
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 disabled:opacity-50 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                    aria-label="Export selected leads as CSV"
                >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                    Export CSV
                </button>

                <button
                    onClick={() => runAction("suppress")}
                    disabled={!!busy}
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-[var(--red-glow)] border border-[var(--border-red)] text-[var(--red-text)] hover:bg-[var(--red)]/20 disabled:opacity-50 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                >
                    {busy === "suppress" ? (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                    ) : (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /></svg>
                    )}
                    Suppress
                </button>
                <button onClick={onClear} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors duration-150 ease-out focus-visible:outline-none" aria-label="Clear selection">
                    ✕ Clear
                </button>
            </div>
        </div>
    );
}

const ApolloLogo = () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500 inline-block mr-1 flex-shrink-0">
        <path d="M4.5 16.5c-1.5 1.25-2.5 3.5-2.5 3.5s2.25-1 3.5-2.5" />
        <path d="M12 12l9-9-9 9z" />
        <path d="M12 12c-1.5 1.5-3 3.5-3.5 5.5-.5 2 0 3.5 0 3.5s1.5.5 3.5 0c2-.5 4-2 5.5-3.5" />
        <path d="M19 9c.5-1.5 0-3-1.5-4.5S14.5 4 13 4.5l-6 6c-2 2-3 4-3.5 6-.5 2 0 3.5 0 3.5s1-.5 3-0c2-.5 4-1.5 6-3.5l6-6z" />
    </svg>
);

const GoogleMapsLogo = () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500 inline-block mr-1 flex-shrink-0">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
        <circle cx="12" cy="10" r="3" />
    </svg>
);

const GlobeIcon = () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sky-400 inline-block mr-1 flex-shrink-0">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
);

const getCompanyLocation = (lead: Lead) => {
    if (lead.enrichmentData && typeof lead.enrichmentData === "object") {
        const data = lead.enrichmentData as any;
        if (data.location) return data.location;
        if (data.country) {
            return data.city ? `${data.city}, ${data.country}` : data.country;
        }
    }
    return lead.companyName || "—";
};

interface InteractiveCellProps {
    value: string | null;
    onSave: (newValue: string) => Promise<void>;
    placeholder?: string;
    cellRef?: React.RefObject<HTMLDivElement | null>;
    onNavigate?: (dir: "up" | "down" | "left" | "right") => void;
}

function InteractiveCell({ value, onSave, placeholder = "—", cellRef, onNavigate }: InteractiveCellProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [tempValue, setTempValue] = useState(value ?? "");
    const [loading, setLoading] = useState(false);
    const [copied, setCopied] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);

    useEffect(() => {
        setTempValue(value ?? "");
    }, [value]);

    const handleCopy = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!value) return;
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch (err) {
            console.error(err);
        }
    };

    const handleInputKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            inputRef.current?.blur();
        } else if (e.key === "Escape") {
            setTempValue(value ?? "");
            setIsEditing(false);
            setTimeout(() => cellRef?.current?.focus(), 0);
        } else if (["ArrowUp", "ArrowDown"].includes(e.key)) {
            e.preventDefault();
            inputRef.current?.blur();
            onNavigate?.(e.key === "ArrowUp" ? "up" : "down");
        }
    };

    const handleCellKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Enter" || e.key === "F2") {
            e.preventDefault();
            setIsEditing(true);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            onNavigate?.("up");
        } else if (e.key === "ArrowDown") {
            e.preventDefault();
            onNavigate?.("down");
        } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            onNavigate?.("left");
        } else if (e.key === "ArrowRight") {
            e.preventDefault();
            onNavigate?.("right");
        } else if (e.key === "Tab") {
            onNavigate?.(e.shiftKey ? "left" : "right");
        }
    };

    const handleBlur = async () => {
        if (tempValue === (value ?? "")) {
            setIsEditing(false);
            return;
        }
        setLoading(true);
        try {
            await onSave(tempValue);
            setIsEditing(false);
        } catch (err) {
            console.error(err);
            setTempValue(value ?? "");
        } finally {
            setLoading(false);
        }
    };

    if (isEditing) {
        return (
            <div className="w-full flex items-center" onClick={(e) => e.stopPropagation()}>
                <input
                    ref={inputRef}
                    type="text"
                    value={tempValue}
                    onChange={(e) => setTempValue(e.target.value)}
                    onKeyDown={handleInputKeyDown}
                    onBlur={handleBlur}
                    disabled={loading}
                    className="w-full bg-[var(--surface-2)] border border-[var(--border-red)] text-xs text-[var(--text-primary)] rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-[var(--red)] transition-all"
                />
                {loading && (
                    <svg className="animate-spin ml-1.5 flex-shrink-0 text-[var(--red-text)]" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                )}
            </div>
        );
    }

    return (
        <div
            ref={cellRef}
            tabIndex={0}
            role="gridcell"
            className="group/cell relative w-full h-full min-h-[24px] flex items-center justify-between cursor-text focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--red)] focus-visible:ring-inset rounded-sm"
            onClick={(e) => {
                e.stopPropagation();
                setIsEditing(true);
            }}
            onKeyDown={handleCellKeyDown}
        >
            <span className={`truncate mr-6 ${!value ? "text-[var(--text-muted)] italic" : "text-[var(--text-secondary)]"}`}>
                {value || placeholder}
            </span>
            {value && (
                <button
                    onClick={handleCopy}
                    className="absolute right-0 opacity-0 group-hover/cell:opacity-100 p-1 hover:bg-[var(--surface-2)] rounded transition-all duration-150 text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-visible:opacity-100"
                    title="Copy to clipboard"
                    aria-label="Copy cell value"
                >
                    {copied ? (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-emerald-400">
                            <polyline points="20 6 9 17 4 12" />
                        </svg>
                    ) : (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                    )}
                </button>
            )}
        </div>
    );
}

interface ColumnConfig {
    id: string;
    label: string;
    width: number;
    visible: boolean;
    resizable: boolean;
}

const INITIAL_COLUMNS: ColumnConfig[] = [
    { id: "lead", label: "Lead", width: 180, visible: true, resizable: true },
    { id: "title", label: "Title", width: 160, visible: true, resizable: true },
    { id: "email", label: "Email", width: 200, visible: true, resizable: true },
    { id: "location", label: "Location", width: 180, visible: true, resizable: true },
    { id: "website", label: "Website", width: 180, visible: true, resizable: true },
    { id: "status", label: "Status", width: 130, visible: true, resizable: true },
    { id: "score", label: "Score", width: 110, visible: true, resizable: true },
    { id: "signals", label: "Signals", width: 220, visible: true, resizable: true },
    { id: "messages", label: "Messages", width: 90, visible: true, resizable: true },
    { id: "replies", label: "Replies", width: 85, visible: true, resizable: true },
    { id: "enrich", label: "Enrich", width: 130, visible: true, resizable: true },
];

function InteractiveStatusCell({ lead, onSave }: { lead: Lead; onSave: (newStage: string) => Promise<void> }) {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const currentStage = lead.pipelineStage || "PROSPECT";

    const STAGE_LABELS: Record<string, string> = {
        PROSPECT: "Prospect",
        ENGAGED: "Engaged",
        HOT: "Hot",
        MEETING_BOOKED: "Meeting Booked",
        DISQUALIFIED: "Disqualified",
    };

    const STAGE_COLORS: Record<string, string> = {
        PROSPECT: "bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border)]",
        ENGAGED: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
        HOT: "bg-orange-500/10 text-orange-400 border-orange-500/20",
        MEETING_BOOKED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
        DISQUALIFIED: "bg-[var(--red-glow)] text-[var(--red-text)] border-[var(--border-red)]/20",
    };

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        }
        if (open) {
            document.addEventListener("mousedown", handleClickOutside);
        }
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [open]);

    const handleSelect = async (stage: string) => {
        setOpen(false);
        if (stage === currentStage) return;
        await onSave(stage);
    };

    return (
        <div ref={containerRef} className="relative inline-block text-left">
            <button
                type="button"
                onClick={() => setOpen(!open)}
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border transition-colors ${STAGE_COLORS[currentStage] || STAGE_COLORS.PROSPECT}`}
            >
                <span className="w-1.5 h-1.5 rounded-full bg-current" />
                <span>{STAGE_LABELS[currentStage] || currentStage}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="opacity-60">
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </button>

            {open && (
                <div className="absolute left-0 mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-xl py-1 z-30 w-40 text-left">
                    {Object.entries(STAGE_LABELS).map(([stage, label]) => (
                        <button
                            key={stage}
                            type="button"
                            onClick={() => handleSelect(stage)}
                            className={`w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-[var(--surface-2)] flex items-center gap-2 ${stage === currentStage ? "text-[var(--red-text)] font-semibold" : "text-[var(--text-secondary)]"}`}
                        >
                            <span className={`w-1.5 h-1.5 rounded-full bg-current ${STAGE_COLORS[stage]?.split(" ")[1]}`} />
                            {label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

interface LeadsTabProps {
    campaignId: string;
    campaign?: Campaign | null;
}

export function LeadsTab({ campaignId, campaign }: LeadsTabProps) {
    const [leads, setLeads] = useState<Lead[]>([]);
    const [meta, setMeta] = useState<LeadsMeta>({ total: 0, page: 1, limit: 20, totalPages: 1 });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [page, setPage] = useState(1);
    const [detailLead, setDetailLead] = useState<Lead | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [lookalikeBusy, setLookalikeBusy] = useState(false);
    const [lookalikeMsg, setLookalikeMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
    const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
    const [isDiscovering, setIsDiscovering] = useState(false);
    const [showSetupDrawer, setShowSetupDrawer] = useState(false);
    const { toasts, addToast, dismiss } = useToast();

    const [filterHasEmail, setFilterHasEmail] = useState(false);
    const [filterNoEmail, setFilterNoEmail] = useState(false);
    const [filterScore70, setFilterScore70] = useState(false);
    const [filterInSequence, setFilterInSequence] = useState(false);
    const [filterReplied, setFilterReplied] = useState(false);

    const [columns, setColumns] = useState<ColumnConfig[]>([]);
    const [showColumnMenu, setShowColumnMenu] = useState(false);
    const columnMenuRef = useRef<HTMLDivElement>(null);
    const columnsRef = useRef<ColumnConfig[]>([]);

    useEffect(() => {
        const saved = localStorage.getItem("leads-columns-v2");
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                const merged = INITIAL_COLUMNS.map(col => {
                    const found = parsed.find((p: any) => p.id === col.id);
                    if (found) {
                        return { ...col, visible: found.visible, width: found.width };
                    }
                    return col;
                });
                setColumns(merged);
                columnsRef.current = merged;
                return;
            } catch { }
        }
        setColumns(INITIAL_COLUMNS);
        columnsRef.current = INITIAL_COLUMNS;
    }, []);

    const saveColumns = (cols: ColumnConfig[]) => {
        setColumns(cols);
        columnsRef.current = cols;
        localStorage.setItem("leads-columns-v2", JSON.stringify(cols));
    };

    const resizingColId = useRef<string | null>(null);
    const startX = useRef<number>(0);
    const startWidth = useRef<number>(0);

    const handleResizeMove = useCallback((e: MouseEvent) => {
        if (!resizingColId.current) return;
        const deltaX = e.clientX - startX.current;
        const newWidth = Math.max(50, startWidth.current + deltaX);
        setColumns(prev => {
            const next = prev.map(c => c.id === resizingColId.current ? { ...c, width: newWidth } : c);
            columnsRef.current = next;
            return next;
        });
    }, []);

    const handleResizeEnd = useCallback(() => {
        resizingColId.current = null;
        document.removeEventListener("mousemove", handleResizeMove);
        document.removeEventListener("mouseup", handleResizeEnd);
        localStorage.setItem("leads-columns-v2", JSON.stringify(columnsRef.current));
    }, [handleResizeMove]);

    const handleResizeStart = (e: React.MouseEvent, id: string) => {
        e.preventDefault();
        resizingColId.current = id;
        startX.current = e.clientX;
        const col = columnsRef.current.find(c => c.id === id);
        if (col) {
            startWidth.current = col.width;
        }
        document.addEventListener("mousemove", handleResizeMove);
        document.addEventListener("mouseup", handleResizeEnd);
    };

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

    async function handleLookalike() {
        if (lookalikeBusy) return;
        setLookalikeBusy(true);
        setLookalikeMsg(null);
        try {
            const res = await fetch(`/api/campaigns/${campaignId}/lookalike`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new Error(body?.error ?? `Request failed (${res.status})`);
            }
            setLookalikeMsg({ type: "ok", text: "Lookalike search queued" });
            setTimeout(() => setLookalikeMsg(null), 4000);
        } catch (err) {
            setLookalikeMsg({ type: "err", text: err instanceof Error ? err.message : "Request failed" });
            setTimeout(() => setLookalikeMsg(null), 6000);
        } finally {
            setLookalikeBusy(false);
        }
    }

    async function handleDiscover() {
        if (isDiscovering) return;
        setIsDiscovering(true);
        try {
            const res = await fetch(`/api/campaigns/${campaignId}/discover`, { method: "POST" });
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new Error(body?.error ?? `Request failed (${res.status})`);
            }
            setTimeout(() => fetchLeads(), 1500);
        } catch {
            // silent — user can retry from topbar
        } finally {
            setIsDiscovering(false);
        }
    }

    useEffect(() => {
        const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 350);
        return () => clearTimeout(t);
    }, [search]);

    const fetchLeads = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({
                campaignId,
                page: String(page),
                limit: "20",
                ...(debouncedSearch && { search: debouncedSearch }),
            });
            const res = await fetch(`/api/leads?${params}`);
            if (!res.ok) throw new Error(`Server error ${res.status}`);
            const json = await res.json();
            setLeads(json.data);
            setMeta(json.meta);
            setSelected(new Set());
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load leads.");
        } finally {
            setLoading(false);
        }
    }, [campaignId, page, debouncedSearch]);

    useEffect(() => { fetchLeads(); }, [fetchLeads]);

    const [showEnrichDropdown, setShowEnrichDropdown] = useState(false);
    const [enrichingIds, setEnrichingIds] = useState<Set<string>>(new Set());
    const enrichDropdownRef = useRef<HTMLTableHeaderCellElement>(null);
    const gridRefs = useRef<Record<string, Record<number, React.RefObject<HTMLDivElement | null>>>>({});

    function getOrCreateCellRef(leadId: string, col: number): React.RefObject<HTMLDivElement | null> {
        if (!gridRefs.current[leadId]) gridRefs.current[leadId] = {};
        if (!gridRefs.current[leadId][col]) gridRefs.current[leadId][col] = React.createRef<HTMLDivElement>();
        return gridRefs.current[leadId][col];
    }

    function focusCell(leadId: string, col: number) {
        gridRefs.current[leadId]?.[col]?.current?.focus();
    }

    function handleNavigate(leads: Lead[], leadId: string, col: number, dir: "up" | "down" | "left" | "right") {
        const rowIdx = leads.findIndex(l => l.id === leadId);
        const cols = [0, 1, 2];
        const colIdx = cols.indexOf(col);
        if (dir === "up" && rowIdx > 0) { focusCell(leads[rowIdx - 1].id, col); }
        else if (dir === "down" && rowIdx < leads.length - 1) { focusCell(leads[rowIdx + 1].id, col); }
        else if (dir === "left" && colIdx > 0) { focusCell(leadId, cols[colIdx - 1]); }
        else if (dir === "right" && colIdx < cols.length - 1) { focusCell(leadId, cols[colIdx + 1]); }
    }

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (enrichDropdownRef.current && !enrichDropdownRef.current.contains(event.target as Node)) {
                setShowEnrichDropdown(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    async function handleUpdateLead(leadId: string, updates: Partial<Lead>) {
        try {
            const res = await fetch(`/api/leads/${leadId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updates),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data?.error ?? "Failed to update lead");
            }
            const updated = await res.json();
            setLeads(prev => prev.map(l => l.id === leadId ? { ...l, ...updated } : l));
        } catch (err) {
            addToast("error", err instanceof Error ? err.message : "Failed to update lead");
            throw err;
        }
    }

    async function handleSingleEnrich(leadId: string) {
        setEnrichingIds(prev => { const next = new Set(prev); next.add(leadId); return next; });
        const safetyTimer = setTimeout(() => {
            setEnrichingIds(prev => { const next = new Set(prev); next.delete(leadId); return next; });
        }, 45_000);
        try {
            const res = await fetch(`/api/leads/${leadId}/enrich`, { method: "POST" });
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new Error(body?.error ?? "Failed to enrich lead");
            }
            setLookalikeMsg({ type: "ok", text: "Lead enrichment queued" });
            setTimeout(() => setLookalikeMsg(null), 4000);
            await fetchLeads();
        } catch (err) {
            setLookalikeMsg({ type: "err", text: err instanceof Error ? err.message : "Failed to enrich lead" });
            setTimeout(() => setLookalikeMsg(null), 6000);
        } finally {
            clearTimeout(safetyTimer);
            setEnrichingIds(prev => { const next = new Set(prev); next.delete(leadId); return next; });
        }
    }

    async function handleBulkEnrich(type: "email" | "tech") {
        if (selected.size === 0) return;
        const count = selected.size;
        try {
            const res = await fetch(`/api/leads/bulk/enrich`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ leadIds: selectedIds }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new Error(body?.error ?? "Bulk enrichment failed");
            }
            setSelected(new Set());
            setLookalikeMsg({ type: "ok", text: `Enrichment queued for ${count} leads` });
            setTimeout(() => setLookalikeMsg(null), 4000);
            await fetchLeads();
        } catch (err) {
            setLookalikeMsg({ type: "err", text: err instanceof Error ? err.message : "Bulk enrichment failed" });
            setTimeout(() => setLookalikeMsg(null), 6000);
        } finally {
            setShowEnrichDropdown(false);
        }
    }

    const filteredLeads = leads.filter((lead) => {
        if (filterHasEmail && (!lead.email || lead.email.trim() === "")) {
            return false;
        }
        if (filterNoEmail && (lead.email && lead.email.trim() !== "")) {
            return false;
        }
        if (filterScore70) {
            const displayScore = lead.qualificationScore != null
                ? (lead.qualificationScore <= 1 ? lead.qualificationScore * 100 : lead.qualificationScore)
                : 0;
            if (displayScore <= 70) {
                return false;
            }
        }
        if (filterInSequence) {
            const isEnrolled = (lead.stepStatuses && lead.stepStatuses.length > 0) || (lead.outreachMessages && lead.outreachMessages.length > 0);
            if (!isEnrolled) {
                return false;
            }
        }
        if (filterReplied) {
            const isReplied = lead.outreachMessages?.some(m => m.deliveryState === "REPLIED") || (lead._count?.replies ?? 0) > 0;
            if (!isReplied) {
                return false;
            }
        }
        return true;
    });

    const allPageSelected = filteredLeads.length > 0 && filteredLeads.every((l) => selected.has(l.id));

    function toggleAll() {
        if (allPageSelected) {
            setSelected((prev) => { const next = new Set(prev); filteredLeads.forEach((l) => next.delete(l.id)); return next; });
        } else {
            setSelected((prev) => { const next = new Set(prev); filteredLeads.forEach((l) => next.add(l.id)); return next; });
        }
    }

    function toggleOne(id: string) {
        setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
    }

    const selectedIds = Array.from(selected);

    const isIcpDone = !!campaign?.icpDescription;
    const isSenderDone = !!(campaign?.senderDomain || campaign?.senderMailboxId || campaign?.linkedInAccountId);
    const isDiscoveryDone = campaign?.status !== "DRAFT";

    const [bannerDismissed, setBannerDismissed] = useState(false);
    const [bannerBusy, setBannerBusy] = useState(false);
    const [bannerResult, setBannerResult] = useState<string | null>(null);

    const unscoredWithEmail = leads.filter(
        (l) => l.email && l.qualificationScore == null
    );
    const showUnscoredBanner =
        !bannerDismissed &&
        isIcpDone &&
        unscoredWithEmail.length > 0 &&
        !loading;

    async function handleScoreAllUnscored() {
        if (bannerBusy) return;
        setBannerBusy(true);
        setBannerResult(null);
        try {
            const res = await fetch(`/api/leads/bulk/score-and-enrich`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    campaignId,
                    leadIds: unscoredWithEmail.map((l) => l.id),
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status})`);
            setBannerResult(`${data.qualified ?? 0} qualified · ${data.disqualified ?? 0} disqualified${data.enrichmentQueued ? ` · ${data.enrichmentQueued} enrichment jobs queued` : ""}`);
            setTimeout(() => { setBannerDismissed(true); fetchLeads(); }, 3500);
        } catch (err) {
            setBannerResult(err instanceof Error ? err.message : "Request failed");
            setTimeout(() => setBannerResult(null), 5000);
        } finally {
            setBannerBusy(false);
        }
    }


    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (columnMenuRef.current && !columnMenuRef.current.contains(event.target as Node)) {
                setShowColumnMenu(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    function renderHeaderContent(c: ColumnConfig) {
        switch (c.id) {
            case "lead":
                return <span>Lead</span>;
            case "title":
                return (
                    <div className="flex items-center gap-1">
                        <ApolloLogo />
                        <span>Title</span>
                    </div>
                );
            case "email":
                return (
                    <div className="flex items-center gap-1">
                        <ApolloLogo />
                        <span>Email</span>
                    </div>
                );
            case "location":
                return (
                    <div className="flex items-center gap-1">
                        <GoogleMapsLogo />
                        <span>Location</span>
                    </div>
                );
            case "website":
                return (
                    <div className="flex items-center gap-1">
                        <GlobeIcon />
                        <span>Website</span>
                    </div>
                );
            case "status":
                return <span>Status</span>;
            case "score":
                return <span>Score</span>;
            case "signals":
                return <span>Signals</span>;
            case "messages":
                return <span>Messages</span>;
            case "replies":
                return <span>Replies</span>;
            case "enrich":
                return (
                    <div ref={enrichDropdownRef} className="relative group/enrich-header w-full">
                        <div className="flex items-center justify-between gap-1 cursor-pointer select-none" onClick={() => setShowEnrichDropdown(!showEnrichDropdown)}>
                            <span>Enrich</span>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <polyline points="6 9 12 15 18 9" />
                            </svg>
                        </div>
                        {showEnrichDropdown && (
                            <div className="absolute right-0 top-full mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-xl py-1 z-20 w-48 text-left normal-case font-normal text-xs text-[var(--text-primary)]">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setShowEnrichDropdown(false);
                                        handleBulkEnrich("email");
                                    }}
                                    disabled={selected.size === 0}
                                    className="w-full text-left px-3 py-2 hover:bg-[var(--surface-2)] transition-colors duration-150 ease-out flex items-center gap-2 disabled:opacity-50 disabled:hover:bg-transparent"
                                >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                                        <polyline points="22,6 12,13 2,6" />
                                    </svg>
                                    Find Email via Waterfalls
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setShowEnrichDropdown(false);
                                        handleBulkEnrich("tech");
                                    }}
                                    disabled={selected.size === 0}
                                    className="w-full text-left px-3 py-2 hover:bg-[var(--surface-2)] transition-colors duration-150 ease-out flex items-center gap-2 disabled:opacity-50 disabled:hover:bg-transparent"
                                >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <polyline points="16 18 22 12 16 6" />
                                        <polyline points="8 6 2 12 8 18" />
                                    </svg>
                                    Detect Tech Stack
                                </button>
                                <div className="border-t border-[var(--border)] my-1" />
                                <div className="px-3 py-1 text-[10px] text-[var(--text-muted)]">
                                    {selected.size === 0 ? "Select leads to enrich" : `${selected.size} selected`}
                                </div>
                            </div>
                        )}
                    </div>
                );
            default:
                return <span>{c.label}</span>;
        }
    }

    return (
        <div className={`flex flex-col h-full transition-[margin-right] duration-200 ${detailLead ? "md:mr-[480px] lg:mr-[600px]" : ""}`}>
            <ToastRegion toasts={toasts} onDismiss={dismiss} />
            {selected.size > 0 && (
                <BulkActionBar
                    count={selected.size}
                    campaignId={campaignId}
                    selectedIds={selectedIds}
                    selectedLeads={filteredLeads.filter((l) => selected.has(l.id))}
                    onClear={() => setSelected(new Set())}
                    onDone={fetchLeads}
                />
            )}

            {showUnscoredBanner && (
                <div className="flex items-center gap-3 px-5 py-2.5 bg-sky-500/8 border-b border-sky-500/20 flex-shrink-0">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-sky-400 flex-shrink-0" aria-hidden="true">
                        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    {bannerResult ? (
                        <span className="text-xs font-medium text-emerald-400 flex-1">{bannerResult}</span>
                    ) : (
                        <span className="text-xs text-sky-300 flex-1">
                            <span className="font-semibold">{unscoredWithEmail.length} lead{unscoredWithEmail.length !== 1 ? "s" : ""}</span> have emails but haven't been scored or researched yet.
                        </span>
                    )}
                    {!bannerResult && (
                        <button
                            id="btn-score-all-unscored"
                            onClick={handleScoreAllUnscored}
                            disabled={bannerBusy}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-sky-500/15 border border-sky-500/30 text-sky-300 hover:bg-sky-500/25 disabled:opacity-50 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 flex-shrink-0"
                        >
                            {bannerBusy ? (
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                            ) : (
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="13 17 18 12 13 7" /><polyline points="6 17 11 12 6 7" /></svg>
                            )}
                            {bannerBusy ? "Scoring…" : "Score & Research All"}
                        </button>
                    )}
                    <button
                        onClick={() => setBannerDismissed(true)}
                        className="p-1 rounded text-sky-400/50 hover:text-sky-400 transition-colors flex-shrink-0 focus-visible:outline-none"
                        aria-label="Dismiss banner"
                    >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                </div>
            )}


            <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-[var(--border)] flex-shrink-0 bg-[var(--navy-mid)]">
                <div className="relative flex-1 max-w-sm">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <input type="search" placeholder="Search leads…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search leads" className="w-full pl-9 pr-4 py-2 text-sm bg-[var(--surface)] border border-[var(--border)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-red)] focus:ring-1 focus:ring-[var(--red)] transition-colors duration-150" />
                </div>
                <div className="flex items-center gap-3">
                    <div ref={columnMenuRef} className="relative">
                        <button
                            type="button"
                            onClick={() => setShowColumnMenu(!showColumnMenu)}
                            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)]/40 hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none"
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" />
                            </svg>
                            Columns
                        </button>
                        {showColumnMenu && (
                            <div className="absolute right-0 mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-xl py-2 z-20 w-48 text-left">
                                <div className="px-3 pb-1 border-b border-[var(--border)] mb-1">
                                    <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Show/Hide Columns</span>
                                </div>
                                <div className="max-h-60 overflow-y-auto px-1">
                                    {columns.map(c => (
                                        <label key={c.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-[var(--surface-2)] cursor-pointer text-xs text-[var(--text-secondary)] select-none">
                                            <input
                                                type="checkbox"
                                                checked={c.visible}
                                                onChange={(e) => {
                                                    const updated = columns.map(col => col.id === c.id ? { ...col, visible: e.target.checked } : col);
                                                    saveColumns(updated);
                                                }}
                                                className="rounded border-[var(--border)] bg-[var(--surface-2)] text-[var(--red-text)] focus:ring-[var(--red)]/20 w-3.5 h-3.5 accent-[var(--red)] cursor-pointer"
                                            />
                                            {c.label}
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="flex items-center gap-0.5 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg p-0.5 mr-1">
                        <button
                            type="button"
                            onClick={() => changeDensity("comfortable")}
                            aria-label="Comfortable layout"
                            className={`p-1.5 rounded transition-all duration-150 ${density === "comfortable" ? "bg-[var(--red-glow)] text-[var(--red-text)] border border-[var(--border-red)]/20" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
                            </svg>
                        </button>
                        <button
                            type="button"
                            onClick={() => changeDensity("compact")}
                            aria-label="Compact layout"
                            className={`p-1.5 rounded transition-all duration-150 ${density === "compact" ? "bg-[var(--red-glow)] text-[var(--red-text)] border border-[var(--border-red)]/20" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <line x1="3" y1="4" x2="21" y2="4" /><line x1="3" y1="8" x2="21" y2="8" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="16" x2="21" y2="16" /><line x1="3" y1="20" x2="21" y2="20" />
                            </svg>
                        </button>
                    </div>
                    <span className="text-xs text-[var(--text-muted)]">
                        {filteredLeads.length === leads.length ? `${meta.total} leads` : `${filteredLeads.length} of ${leads.length} filtered`}
                    </span>
                    {lookalikeMsg && (
                        <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${lookalikeMsg.type === "ok" ? "bg-emerald-400/10 border-emerald-400/20 text-emerald-400" : "bg-red-400/10 border-red-400/20 text-red-400"}`}>
                            {lookalikeMsg.text}
                        </span>
                    )}
                    <button
                        onClick={handleLookalike}
                        disabled={lookalikeBusy}
                        aria-label="Find similar leads using AI lookalike search"
                        className="inline-flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg bg-[var(--red)] text-white hover:bg-[var(--red-dim)] active:scale-[0.97] transition-all duration-150 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        {lookalikeBusy ? (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                        ) : (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                        )}
                        {lookalikeBusy ? "Searching…" : "Find Similar"}
                    </button>
                    {(!isIcpDone || !isSenderDone || !isDiscoveryDone) && (
                        <button
                            onClick={() => setShowSetupDrawer(true)}
                            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-amber-400/30 bg-amber-400/8 text-amber-400 hover:bg-amber-400/15 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                            title="Campaign setup checklist"
                        >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
                            Setup
                            <span className="w-4 h-4 rounded-full bg-amber-400/20 text-amber-400 text-[9px] font-bold flex items-center justify-center">
                                {[isIcpDone, isSenderDone, isDiscoveryDone].filter(b => !b).length}
                            </span>
                        </button>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-2 px-6 py-2 bg-[var(--navy-deep)] border-b border-[var(--border)] flex-wrap flex-shrink-0">
                <span className="text-xs text-[var(--text-muted)] mr-2 font-medium">Filters:</span>
                <button
                    onClick={() => {
                        setFilterHasEmail(!filterHasEmail);
                        setFilterNoEmail(false);
                    }}
                    className={`px-3 py-1 text-xs font-semibold rounded-full border transition-all duration-150 flex items-center gap-1 ${filterHasEmail
                            ? "bg-[var(--red-glow)] text-[var(--red-text)] border-[var(--border-red)]/20"
                            : "bg-[var(--surface)] text-[var(--text-secondary)] border-[var(--border)] hover:border-[var(--text-muted)]"
                        }`}
                >
                    Has Email
                </button>
                <button
                    onClick={() => {
                        setFilterNoEmail(!filterNoEmail);
                        setFilterHasEmail(false);
                    }}
                    className={`px-3 py-1 text-xs font-semibold rounded-full border transition-all duration-150 flex items-center gap-1 ${filterNoEmail
                            ? "bg-[var(--red-glow)] text-[var(--red-text)] border-[var(--border-red)]/20"
                            : "bg-[var(--surface)] text-[var(--text-secondary)] border-[var(--border)] hover:border-[var(--text-muted)]"
                        }`}
                >
                    No Email
                </button>
                <button
                    onClick={() => setFilterScore70(!filterScore70)}
                    className={`px-3 py-1 text-xs font-semibold rounded-full border transition-all duration-150 flex items-center gap-1 ${filterScore70
                            ? "bg-[var(--red-glow)] text-[var(--red-text)] border-[var(--border-red)]/20"
                            : "bg-[var(--surface)] text-[var(--text-secondary)] border-[var(--border)] hover:border-[var(--text-muted)]"
                        }`}
                >
                    Score &gt; 70
                </button>
                <button
                    onClick={() => setFilterInSequence(!filterInSequence)}
                    className={`px-3 py-1 text-xs font-semibold rounded-full border transition-all duration-150 flex items-center gap-1 ${filterInSequence
                            ? "bg-[var(--red-glow)] text-[var(--red-text)] border-[var(--border-red)]/20"
                            : "bg-[var(--surface)] text-[var(--text-secondary)] border-[var(--border)] hover:border-[var(--text-muted)]"
                        }`}
                >
                    In Sequence
                </button>
                <button
                    onClick={() => setFilterReplied(!filterReplied)}
                    className={`px-3 py-1 text-xs font-semibold rounded-full border transition-all duration-150 flex items-center gap-1 ${filterReplied
                            ? "bg-[var(--red-glow)] text-[var(--red-text)] border-[var(--border-red)]/20"
                            : "bg-[var(--surface)] text-[var(--text-secondary)] border-[var(--border)] hover:border-[var(--text-muted)]"
                        }`}
                >
                    Replied
                </button>
                {(filterHasEmail || filterNoEmail || filterScore70 || filterInSequence || filterReplied) && (
                    <button
                        onClick={() => {
                            setFilterHasEmail(false);
                            setFilterNoEmail(false);
                            setFilterScore70(false);
                            setFilterInSequence(false);
                            setFilterReplied(false);
                        }}
                        className="text-xs text-[var(--text-muted)] hover:text-[var(--red-text)] ml-2 transition-colors"
                    >
                        Clear all
                    </button>
                )}
            </div>

            <div className="flex-1 overflow-auto bg-[var(--surface)]">
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <svg className="animate-spin text-[var(--red-text)]" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
                        <p className="text-sm text-[var(--red-text)]">{error}</p>
                        <button onClick={fetchLeads} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] underline">Retry</button>
                    </div>
                ) : !leads.length && !isIcpDone ? null : leads.length > 0 ? (
                    <table className="w-full text-left border-collapse table-fixed min-w-[1550px]" aria-label="Campaign leads">
                        <colgroup>
                            <col className="w-10" />
                            {columns.filter(c => c.visible).map(c => (
                                <col key={c.id} style={{ width: `${c.width}px` }} />
                            ))}
                            <col className="w-10" />
                        </colgroup>
                        <thead className="sticky top-0 z-10 bg-[var(--navy-mid)] [box-shadow:0_1px_0_0_var(--red-glow)]">
                            <tr>
                                <th scope="col" className={`${density === "compact" ? "px-2 py-1" : "px-3 py-2"} border border-[var(--border)] text-xs font-semibold text-[var(--text-muted)] whitespace-nowrap w-10`}>
                                    <input type="checkbox" checked={allPageSelected} onChange={toggleAll} aria-label="Select all leads on this page" className="w-3.5 h-3.5 rounded border-[var(--border)] bg-[var(--surface)] accent-[var(--red)] cursor-pointer" />
                                </th>
                                {columns.filter(c => c.visible).map((c) => (
                                    <th
                                        key={c.id}
                                        scope="col"
                                        className="relative border border-[var(--border)] text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)] whitespace-nowrap"
                                    >
                                        <div className={`${density === "compact" ? "px-2 py-1" : "px-3 py-2"} flex items-center justify-between min-w-0 h-full`}>
                                            {renderHeaderContent(c)}
                                        </div>
                                        {c.resizable && (
                                            <div
                                                onMouseDown={(e) => handleResizeStart(e, c.id)}
                                                className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-[var(--red)]/40 active:bg-[var(--red)] z-10 transition-colors select-none"
                                                style={{ touchAction: "none" }}
                                            />
                                        )}
                                    </th>
                                ))}
                                <th scope="col" className="border border-[var(--border)] w-10"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredLeads.map((lead) => {
                                const cellPadding = density === "compact" ? "px-2 py-1" : "px-3 py-2";
                                const avatarSize = density === "compact" ? "w-6 h-6 text-[10px]" : "w-8 h-8 text-xs";
                                const textCls = density === "compact" ? "text-xs" : "text-sm";

                                return (
                                    <Fragment key={lead.id}>
                                        <tr
                                            className={`group border-b border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors duration-100 cursor-pointer ${selected.has(lead.id) ? "bg-[var(--red-glow)]" : ""}`}
                                            onClick={(e) => { const target = e.target as HTMLElement; if (target.tagName === "INPUT" || target.closest("button")) return; setDetailLead(lead); }}
                                        >
                                            <td className={`${cellPadding} border border-[var(--border)]`} onClick={(e) => e.stopPropagation()}>
                                                <input type="checkbox" checked={selected.has(lead.id)} onChange={() => toggleOne(lead.id)} aria-label={`Select ${lead.firstName ?? lead.companyName}`} className="w-3.5 h-3.5 rounded border-[var(--border)] bg-[var(--surface)] accent-[var(--red)] cursor-pointer" />
                                            </td>
                                            {columns.filter(c => c.visible).map(c => {
                                                switch (c.id) {
                                                    case "lead":
                                                        return (
                                                            <td key={c.id} className={`${cellPadding} border border-[var(--border)]`} onClick={(e) => e.stopPropagation()}>
                                                                <div className="flex items-center gap-2 min-w-0">
                                                                    <div className={`${avatarSize} rounded-full bg-gradient-to-br from-[var(--navy-deep)] to-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center font-bold text-[var(--text-secondary)] flex-shrink-0`}>
                                                                        {(lead.firstName?.[0] ?? lead.companyName[0]).toUpperCase()}
                                                                    </div>
                                                                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                                                        <InteractiveCell
                                                                            value={lead.firstName && lead.lastName ? `${lead.firstName} ${lead.lastName}` : (lead.firstName ?? lead.companyName)}
                                                                            placeholder="Unknown"
                                                                            onSave={async (val) => {
                                                                                const parts = val.trim().split(/\s+/);
                                                                                const firstName = parts[0] ?? null;
                                                                                const lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;
                                                                                await handleUpdateLead(lead.id, { firstName, lastName });
                                                                            }}
                                                                        />
                                                                        {(() => {
                                                                            const isReplied = lead.outreachMessages?.some(m => m.deliveryState === "REPLIED") || (lead._count?.replies ?? 0) > 0;
                                                                            const isSent = lead.outreachMessages?.some(m => ["SENT", "DELIVERED", "OPENED", "REPLIED"].includes(m.deliveryState));
                                                                            const isEnrolled = (lead.stepStatuses && lead.stepStatuses.length > 0) || (lead.outreachMessages && lead.outreachMessages.length > 0);

                                                                            if (isReplied) {
                                                                                return (
                                                                                    <span title="Replied" className="text-amber-500 flex-shrink-0">
                                                                                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                                                                            <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
                                                                                        </svg>
                                                                                    </span>
                                                                                );
                                                                            }
                                                                            if (isSent) {
                                                                                return (
                                                                                    <div className="flex items-center text-emerald-500 flex-shrink-0" title="Email Sent">
                                                                                        <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                                                                                            <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                                                                                            <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
                                                                                        </svg>
                                                                                        <svg className="w-2 h-2 -ml-1 mt-2.5 bg-[var(--surface)] rounded-full" viewBox="0 0 20 20" fill="currentColor">
                                                                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                                                        </svg>
                                                                                    </div>
                                                                                );
                                                                            }
                                                                            if (isEnrolled) {
                                                                                return (
                                                                                    <span title="Enrolled in Sequence" className="text-indigo-400 flex-shrink-0">
                                                                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                                                                                        </svg>
                                                                                    </span>
                                                                                );
                                                                            }
                                                                            return null;
                                                                        })()}
                                                                    </div>
                                                                </div>
                                                            </td>
                                                        );
                                                    case "title":
                                                        return (
                                                            <td key={c.id} className={`${cellPadding} border border-[var(--border)]`}>
                                                                <InteractiveCell
                                                                    value={lead.title}
                                                                    placeholder="No Title"
                                                                    cellRef={getOrCreateCellRef(lead.id, 0)}
                                                                    onNavigate={(dir) => handleNavigate(filteredLeads, lead.id, 0, dir)}
                                                                    onSave={async (val) => {
                                                                        await handleUpdateLead(lead.id, { title: val || null });
                                                                    }}
                                                                />
                                                            </td>
                                                        );
                                                    case "email":
                                                        return (
                                                            <td key={c.id} className={`${cellPadding} border border-[var(--border)]`}>
                                                                {enrichingIds.has(lead.id) ? (
                                                                    <div className="flex items-center gap-1.5">
                                                                        <svg className="animate-spin text-[var(--red-text)] flex-shrink-0" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                                                                        <div className="h-2.5 rounded bg-[var(--surface-2)] animate-pulse w-24" />
                                                                    </div>
                                                                ) : (
                                                                    <InteractiveCell
                                                                        value={lead.email}
                                                                        placeholder="No Email"
                                                                        cellRef={getOrCreateCellRef(lead.id, 1)}
                                                                        onNavigate={(dir) => handleNavigate(filteredLeads, lead.id, 1, dir)}
                                                                        onSave={async (val) => {
                                                                            await handleUpdateLead(lead.id, { email: val || null });
                                                                        }}
                                                                    />
                                                                )}
                                                            </td>
                                                        );
                                                    case "location":
                                                        return (
                                                            <td key={c.id} className={`${cellPadding} border border-[var(--border)]`}>
                                                                <p className={`${textCls} text-[var(--text-secondary)] truncate`}>
                                                                    {getCompanyLocation(lead)}
                                                                </p>
                                                            </td>
                                                        );
                                                    case "website":
                                                        return (
                                                            <td key={c.id} className={`${cellPadding} border border-[var(--border)]`}>
                                                                <InteractiveCell
                                                                    value={lead.website}
                                                                    placeholder="No Website"
                                                                    cellRef={getOrCreateCellRef(lead.id, 2)}
                                                                    onNavigate={(dir) => handleNavigate(filteredLeads, lead.id, 2, dir)}
                                                                    onSave={async (val) => {
                                                                        await handleUpdateLead(lead.id, { website: val || null });
                                                                    }}
                                                                />
                                                            </td>
                                                        );
                                                    case "status":
                                                        return (
                                                            <td key={c.id} className={`${cellPadding} border border-[var(--border)]`} onClick={(e) => e.stopPropagation()}>
                                                                <InteractiveStatusCell
                                                                    lead={lead}
                                                                    onSave={async (newStage) => {
                                                                        await handleUpdateLead(lead.id, { pipelineStage: newStage });
                                                                    }}
                                                                />
                                                            </td>
                                                        );
                                                    case "score":
                                                        return (
                                                            <td key={c.id} className={`${cellPadding} border border-[var(--border)]`}>
                                                                {enrichingIds.has(lead.id) ? (
                                                                    <div className="h-1.5 rounded-full bg-[var(--surface-2)] animate-pulse w-16" />
                                                                ) : (
                                                                    lead.qualificationScore != null ? <ScoreIndicator score={lead.qualificationScore} /> : <span className="text-xs text-[var(--text-muted)]">—</span>
                                                                )}
                                                            </td>
                                                        );
                                                    case "signals":
                                                        return (
                                                            <td key={c.id} className={`${cellPadding} border border-[var(--border)]`}>
                                                                {enrichingIds.has(lead.id) ? (
                                                                    <div className="flex gap-1">
                                                                        <div className="h-4 w-12 rounded-full bg-[var(--surface-2)] animate-pulse" />
                                                                        <div className="h-4 w-14 rounded-full bg-[var(--surface-2)] animate-pulse" />
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex flex-wrap gap-1">
                                                                        {lead.signals.slice(0, 2).map((sig) => <SignalBadge key={sig.id} type={sig.type} signalType={sig.signalType} value={sig.value} />)}
                                                                        {lead.signals.length > 2 && <span className="text-xs text-[var(--text-muted)]">+{lead.signals.length - 2}</span>}
                                                                    </div>
                                                                )}
                                                            </td>
                                                        );
                                                    case "messages":
                                                        return (
                                                            <td key={c.id} className={`${cellPadding} border border-[var(--border)] ${textCls} text-[var(--text-secondary)] tabular-nums`}>
                                                                {lead._count.outreachMessages}
                                                            </td>
                                                        );
                                                    case "replies":
                                                        return (
                                                            <td key={c.id} className={`${cellPadding} border border-[var(--border)]`}>
                                                                <span className={`${textCls} tabular-nums font-medium ${lead._count.replies > 0 ? "text-emerald-400" : "text-[var(--text-muted)]"}`}>
                                                                    {lead._count.replies}
                                                                </span>
                                                            </td>
                                                        );
                                                    case "enrich":
                                                        return (
                                                            <td key={c.id} className={`${cellPadding} border border-[var(--border)]`} onClick={(e) => e.stopPropagation()}>
                                                                <div className="flex items-center gap-2">
                                                                    <button
                                                                        onClick={() => handleSingleEnrich(lead.id)}
                                                                        disabled={enrichingIds.has(lead.id)}
                                                                        className="inline-flex items-center justify-center p-1 rounded hover:bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all disabled:opacity-50"
                                                                        title="Run enrichment waterfall on this lead"
                                                                    >
                                                                        {enrichingIds.has(lead.id) ? (
                                                                            <svg className="animate-spin text-[var(--red-text)]" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                                                                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                                                                            </svg>
                                                                        ) : (
                                                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                                                                <line x1="12" y1="5" x2="12" y2="19" />
                                                                                <line x1="5" y1="12" x2="19" y2="12" />
                                                                            </svg>
                                                                        )}
                                                                    </button>
                                                                    <span className="text-[10px] text-[var(--text-muted)] whitespace-nowrap">
                                                                        {lead.lastEnrichedAt ? new Date(lead.lastEnrichedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : "Never"}
                                                                    </span>
                                                                </div>
                                                            </td>
                                                        );
                                                    default:
                                                        return null;
                                                }
                                            })}
                                            <td className={`${cellPadding} border border-[var(--border)] text-center`}>
                                                <svg className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors inline-block" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                    <polyline points="9 18 15 12 9 6" />
                                                </svg>
                                            </td>
                                        </tr>
                                    </Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                ) : (
                    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
                        <div className="w-12 h-12 rounded-full bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center text-[var(--text-muted)]">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                        </div>
                        <div className="space-y-1">
                            <p className="text-sm font-semibold text-[var(--text-primary)]">No leads yet</p>
                            <p className="text-xs text-[var(--text-muted)]">Complete the campaign setup to discover your first prospects.</p>
                        </div>
                        <button
                            onClick={() => setShowSetupDrawer(true)}
                            className="inline-flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-lg bg-[var(--red)] text-white hover:bg-[var(--red-dim)] transition-all"
                        >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
                            Open Setup Checklist
                        </button>
                    </div>
                )}
            </div>

            <div className="flex items-center justify-between px-6 py-3 border-t border-[var(--border)] bg-[var(--navy-mid)] flex-shrink-0">
                <span className="text-xs text-[var(--text-muted)]">Showing {leads.length} of {meta.total} leads</span>
                <div className="flex items-center gap-1">
                    <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] text-[var(--text-muted)] disabled:opacity-40 hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]">← Prev</button>
                    {Array.from({ length: Math.min(meta.totalPages, 5) }, (_, i) => i + 1).map((p) => (
                        <button key={p} onClick={() => setPage(p)} className={`px-3 py-1.5 text-xs rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] ${p === page ? "bg-[var(--red-glow)] text-[var(--red-text)] border-[var(--border-red)] font-medium" : "border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"}`}>{p}</button>
                    ))}
                    <button disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] text-[var(--text-secondary)] disabled:opacity-40 hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]">Next →</button>
                </div>
            </div>

            {detailLead && (
                <LeadDetailModal
                    lead={detailLead!}
                    onClose={() => setDetailLead(null)}
                    onRefresh={fetchLeads}
                />
            )}

            <SetupChecklist
                isOpen={showSetupDrawer}
                onClose={() => setShowSetupDrawer(false)}
                campaignId={campaignId}
                isIcpDone={isIcpDone}
                isSenderDone={isSenderDone}
                isDiscoveryDone={isDiscoveryDone}
                isDiscovering={isDiscovering}
                onDiscover={handleDiscover}
            />
        </div>
    );
}