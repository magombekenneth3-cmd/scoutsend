"use client";

import React, { useState, useEffect, useCallback, Fragment, useRef } from "react";
import Link from "next/link";

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

type BulkAction = "suppress" | "rescore";

function ScoreBar({ score }: { score: number }) {
    const displayScore = score <= 1 ? Math.round(score * 100) : Math.round(score);
    const color     = displayScore >= 85 ? "bg-emerald-400" : displayScore >= 70 ? "bg-amber-400" : "bg-[var(--red)]";
    const textColor = displayScore >= 85 ? "text-emerald-400" : displayScore >= 70 ? "text-amber-400" : "text-[var(--red)]";
    return (
        <div className="flex items-center gap-2">
            <div className="w-16 h-1.5 bg-[var(--surface-2)] rounded-full overflow-hidden flex-shrink-0">
                <div className={`h-full rounded-full ${color}`} style={{ width: `${displayScore}%` }} role="progressbar" aria-valuenow={displayScore} aria-valuemax={100} aria-label="Qualification score" />
            </div>
            <span className={`text-sm font-semibold tabular-nums ${textColor}`}>{displayScore}</span>
        </div>
    );
}

const SIGNAL_COLORS: Record<string, { bg: string; text: string }> = {
    HIRING:         { bg: "bg-violet-400/10",          text: "text-violet-400" },
    FUNDING:        { bg: "bg-emerald-400/10",          text: "text-emerald-400" },
    EXPANSION:      { bg: "bg-sky-400/10",              text: "text-sky-400" },
    PRODUCT_LAUNCH: { bg: "bg-orange-400/10",           text: "text-orange-400" },
    CONTENT:        { bg: "bg-[var(--surface-2)]",      text: "text-[var(--text-secondary)]" },
};

function SignalTag({ signal }: { signal: Signal }) {
    const rawType = signal.signalType ?? signal.type ?? "";
    const cfg = SIGNAL_COLORS[rawType] ?? SIGNAL_COLORS.CONTENT;
    return (
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`} title={signal.value}>
            <span className="w-1 h-1 rounded-full bg-current opacity-70" aria-hidden="true" />
            {rawType.replace(/_/g, " ")}
        </span>
    );
}

const BREAKDOWN_METRICS: { key: keyof ScoreBreakdown; label: string; color: string }[] = [
    { key: "icpMatch",       label: "ICP Match",       color: "bg-violet-400" },
    { key: "intentStrength", label: "Intent",          color: "bg-sky-400" },
    { key: "fundingSignals", label: "Funding",         color: "bg-emerald-400" },
    { key: "hiringVelocity", label: "Hiring",          color: "bg-orange-400" },
    { key: "techFit",        label: "Tech Fit",        color: "bg-cyan-400" },
    { key: "recency",        label: "Recency",         color: "bg-amber-400" },
];

function ScoreBreakdownGrid({ breakdown }: { breakdown: ScoreBreakdown }) {
    return (
        <div className="space-y-1.5">
            {BREAKDOWN_METRICS.map(({ key, label, color }) => {
                const raw = breakdown[key] ?? 0;
                const pct = raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
                const textCls = pct >= 75 ? "text-emerald-400" : pct >= 50 ? "text-amber-400" : "text-[var(--red)]";
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

function LeadDetailModal({ lead, onClose, onRefresh }: { lead: Lead; onClose: () => void; onRefresh?: () => void }) {
    const [msg, setMsg] = useState<OutreachMessage | null>(null);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [editing, setEditing] = useState(false);
    const [editedSubject, setEditedSubject] = useState("");
    const [editedBody, setEditedBody] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    
    const dialogRef = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        const el = dialogRef.current;
        if (el && !el.open) el.showModal();
    }, []);

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

    function handleCancel(e: React.SyntheticEvent) {
        e.preventDefault();
        onClose();
    }

    function handleBackdrop(e: React.MouseEvent<HTMLDialogElement>) {
        if (e.target === dialogRef.current) onClose();
    }

    const name = lead.firstName ? `${lead.firstName} ${lead.lastName ?? ""}`.trim() : null;
    const initial = (lead.firstName?.[0] ?? lead.companyName[0]).toUpperCase();

    return (
        <dialog
            ref={dialogRef}
            onCancel={handleCancel}
            onClick={handleBackdrop}
            aria-labelledby="lead-detail-modal-title"
            className="modal-panel m-auto w-full max-w-5xl bg-transparent p-4 backdrop:bg-black/70 backdrop:backdrop-blur-md"
        >
            <div className="relative bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150" style={{ maxHeight: "90vh" }}>
                {/* Header */}
                <div className="flex items-center gap-4 px-6 pt-5 pb-4 border-b border-[var(--border)] flex-shrink-0">
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

                {/* Workspace Body */}
                <div className="flex-1 flex flex-col lg:flex-row min-h-0 divide-y lg:divide-y-0 lg:divide-x divide-[var(--border)] overflow-hidden">
                    
                    {/* Left Column: Signal Intelligence */}
                    <div className="w-full lg:w-5/12 bg-[var(--surface-2)]/40 p-6 space-y-6 overflow-y-auto">
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

                    {/* Right Column: Outreach Copywriter */}
                    <div className="w-full lg:w-7/12 p-6 flex flex-col min-h-0 overflow-y-auto">
                        <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-3 flex-shrink-0">Outreach Message Draft</p>
                        
                        {error && <p className="text-xs text-[var(--red)] mb-3 bg-[var(--red-glow)] border border-[var(--border-red)] px-3 py-2 rounded-lg">{error}</p>}
                        
                        <div className="flex-1 flex flex-col min-h-0 justify-center">
                            {loading ? (
                                <div className="flex items-center justify-center gap-2 text-xs text-[var(--text-muted)] py-12">
                                    <svg className="animate-spin text-[var(--text-muted)]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                                    Checking message status...
                                </div>
                            ) : msg ? (
                                <div className="flex-1 flex flex-col min-h-0 bg-[var(--surface-2)]/30 border border-[var(--border)] rounded-xl p-4">
                                    <div className="flex items-center justify-between border-b border-[var(--border)] pb-2 mb-3 flex-shrink-0">
                                        <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                                            msg.approvalStatus === "APPROVED" ? "bg-emerald-500/10 text-emerald-400" :
                                            msg.approvalStatus === "REJECTED" ? "bg-[var(--red-glow)] text-[var(--red)]" : "bg-amber-400/10 text-amber-400"
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
                                                        className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--red)] hover:border-[var(--border-red)] hover:bg-[var(--red-glow)] transition-colors focus-visible:outline-none"
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
                                <div className="flex flex-col items-center justify-center text-center gap-3 py-12 border border-dashed border-[var(--border)] rounded-xl bg-[var(--surface-2)]/10">
                                    <p className="text-xs text-[var(--text-muted)] max-w-xs leading-normal">No message draft has been generated for this lead yet.</p>
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
        </dialog>
    );
}

interface BulkActionBarProps {
    count: number;
    campaignId: string;
    selectedIds: string[];
    onClear: () => void;
    onDone: () => void;
}

function BulkActionBar({ count, campaignId, selectedIds, onClear, onDone }: BulkActionBarProps) {
    const [busy, setBusy]     = useState<BulkAction | null>(null);
    const [result, setResult] = useState<string | null>(null);

    async function runAction(action: BulkAction) {
        setBusy(action);
        setResult(null);
        try {
            const res = await fetch(`/api/leads/bulk/${action}`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ campaignId, leadIds: selectedIds }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
            setResult(action === "suppress"
                ? `${data.deleted ?? selectedIds.length} leads suppressed`
                : `${data.queued ?? selectedIds.length} leads queued for re-scoring`
            );
            setTimeout(() => { setResult(null); onDone(); }, 2500);
        } catch (err) {
            setResult(err instanceof Error ? err.message : "Action failed");
            setTimeout(() => setResult(null), 4000);
        } finally {
            setBusy(null);
        }
    }

    return (
        <div className="flex items-center gap-3 px-6 py-3 bg-[var(--navy-deep)] border-b border-[var(--border-red)] flex-shrink-0">
            <span className="text-xs font-semibold text-[var(--red)] tabular-nums">{count} selected</span>
            {result && <span className="text-xs text-emerald-400 font-medium">{result}</span>}
            <div className="flex items-center gap-2 ml-auto">
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
                    onClick={() => runAction("suppress")}
                    disabled={!!busy}
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-[var(--red-glow)] border border-[var(--border-red)] text-[var(--red)] hover:bg-[var(--red)]/20 disabled:opacity-50 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                >
                    {busy === "suppress" ? (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                    ) : (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /></svg>
                    )}
                    Suppress
                </button>
                <button onClick={onClear} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none" aria-label="Clear selection">
                    ✕ Clear
                </button>
            </div>
        </div>
    );
}

interface LeadsTabProps {
    campaignId: string;
    campaign?: Campaign | null;
}

export function LeadsTab({ campaignId, campaign }: LeadsTabProps) {
    const [leads, setLeads]                   = useState<Lead[]>([]);
    const [meta, setMeta]                     = useState<LeadsMeta>({ total: 0, page: 1, limit: 20, totalPages: 1 });
    const [loading, setLoading]               = useState(true);
    const [error, setError]                   = useState<string | null>(null);
    const [search, setSearch]                 = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [page, setPage]                     = useState(1);
    const [detailLead, setDetailLead]         = useState<Lead | null>(null);
    const [selected, setSelected]             = useState<Set<string>>(new Set());
    const [lookalikeBusy, setLookalikeBusy]   = useState(false);
    const [lookalikeMsg, setLookalikeMsg]     = useState<{ type: "ok" | "err"; text: string } | null>(null);
    const [density, setDensity]               = useState<"comfortable" | "compact">("comfortable");
    const [isDiscovering, setIsDiscovering]   = useState(false);

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

    const allPageSelected = leads.length > 0 && leads.every((l) => selected.has(l.id));

    function toggleAll() {
        if (allPageSelected) {
            setSelected((prev) => { const next = new Set(prev); leads.forEach((l) => next.delete(l.id)); return next; });
        } else {
            setSelected((prev) => { const next = new Set(prev); leads.forEach((l) => next.add(l.id)); return next; });
        }
    }

    function toggleOne(id: string) {
        setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
    }

    const selectedIds = Array.from(selected);

    const isIcpDone = !!campaign?.icpDescription;
    const isSenderDone = !!(campaign?.senderDomain || campaign?.senderMailboxId || campaign?.linkedInAccountId);
    const isDiscoveryDone = campaign?.status !== "DRAFT";

    return (
        <div className="flex flex-col h-full">
            {selected.size > 0 && (
                <BulkActionBar
                    count={selected.size}
                    campaignId={campaignId}
                    selectedIds={selectedIds}
                    onClear={() => setSelected(new Set())}
                    onDone={fetchLeads}
                />
            )}

            <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-[var(--border)] flex-shrink-0 bg-[var(--navy-mid)]">
                <div className="relative flex-1 max-w-sm">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <input type="search" placeholder="Search leads…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search leads" className="w-full pl-9 pr-4 py-2 text-sm bg-[var(--surface)] border border-[var(--border)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-red)] focus:ring-1 focus:ring-[var(--red)] transition-colors duration-150" />
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-0.5 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg p-0.5 mr-1">
                        <button
                            onClick={() => changeDensity("comfortable")}
                            aria-label="Comfortable layout"
                            className={`p-1.5 rounded transition-all duration-150 ${density === "comfortable" ? "bg-[var(--red-glow)] text-[var(--red)] border border-[var(--border-red)]/20" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
                            </svg>
                        </button>
                        <button
                            onClick={() => changeDensity("compact")}
                            aria-label="Compact layout"
                            className={`p-1.5 rounded transition-all duration-150 ${density === "compact" ? "bg-[var(--red-glow)] text-[var(--red)] border border-[var(--border-red)]/20" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <line x1="3" y1="4" x2="21" y2="4" /><line x1="3" y1="8" x2="21" y2="8" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="16" x2="21" y2="16" /><line x1="3" y1="20" x2="21" y2="20" />
                            </svg>
                        </button>
                    </div>
                    <span className="text-xs text-[var(--text-muted)]">{meta.total} leads</span>
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
                </div>
            </div>

            <div className="flex-1 overflow-auto bg-[var(--surface)]">
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <svg className="animate-spin text-[var(--red)]" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
                        <p className="text-sm text-[var(--red)]">{error}</p>
                        <button onClick={fetchLeads} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] underline">Retry</button>
                    </div>
                ) : leads.length > 0 ? (
                    <table className="w-full text-left" aria-label="Campaign leads">
                        <thead className="sticky top-0 z-10 bg-[var(--navy-mid)] border-b border-[var(--border)]">
                            <tr>
                                <th scope="col" className="px-4 py-3 w-10">
                                    <input type="checkbox" checked={allPageSelected} onChange={toggleAll} aria-label="Select all leads on this page" className="w-3.5 h-3.5 rounded border-[var(--border)] bg-[var(--surface)] accent-[var(--red)] cursor-pointer" />
                                </th>
                                {["Lead", "Company", "Score", "Signals", "Messages", "Replies", ""].map((col) => (
                                    <th key={col} scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] whitespace-nowrap">{col}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {leads.map((lead) => {
                                const rowPadding = density === "compact" ? "py-1.5" : "py-3";
                                const avatarSize = density === "compact" ? "w-6 h-6 text-[10px]" : "w-8 h-8 text-xs";
                                const textCls = density === "compact" ? "text-xs" : "text-sm";
                                const subTextCls = "text-xs text-[var(--text-muted)]";

                                return (
                                    <Fragment key={lead.id}>
                                        <tr
                                            className={`group border-b border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors duration-100 cursor-pointer ${selected.has(lead.id) ? "bg-[var(--red-glow)]" : ""}`}
                                            onClick={(e) => { const target = e.target as HTMLElement; if (target.tagName === "INPUT") return; setDetailLead(lead); }}
                                        >
                                            <td className={`px-4 ${rowPadding}`} onClick={(e) => e.stopPropagation()}>
                                                <input type="checkbox" checked={selected.has(lead.id)} onChange={() => toggleOne(lead.id)} aria-label={`Select ${lead.firstName ?? lead.companyName}`} className="w-3.5 h-3.5 rounded border-[var(--border)] bg-[var(--surface)] accent-[var(--red)] cursor-pointer" />
                                            </td>
                                            <td className={`px-4 ${rowPadding}`}>
                                                <div className="flex items-center gap-3">
                                                    <div className={`${avatarSize} rounded-full bg-gradient-to-br from-[var(--navy-deep)] to-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center font-bold text-[var(--text-secondary)] flex-shrink-0`}>
                                                        {(lead.firstName?.[0] ?? lead.companyName[0]).toUpperCase()}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className={`${textCls} font-medium text-[var(--text-primary)] truncate`}>{lead.firstName && lead.lastName ? `${lead.firstName} ${lead.lastName}` : lead.companyName}</p>
                                                        <p className={subTextCls + " truncate"}>{lead.title ?? "—"}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className={`px-4 ${rowPadding}`}>
                                                <p className={`${textCls} text-[var(--text-secondary)] truncate max-w-[140px]`}>{lead.companyName}</p>
                                                {lead.email ? <p className={subTextCls + " truncate max-w-[140px]"}>{lead.email}</p> : <span className="text-[10px] text-amber-400/70">No email</span>}
                                            </td>
                                            <td className={`px-4 ${rowPadding}`}>{lead.qualificationScore != null ? <ScoreBar score={lead.qualificationScore} /> : <span className="text-xs text-[var(--text-muted)]">—</span>}</td>
                                            <td className={`px-4 ${rowPadding}`}>
                                                <div className="flex flex-wrap gap-1">
                                                    {lead.signals.slice(0, 2).map((sig) => <SignalTag key={sig.id} signal={sig} />)}
                                                    {lead.signals.length > 2 && <span className="text-xs text-[var(--text-muted)]">+{lead.signals.length - 2}</span>}
                                                </div>
                                            </td>
                                            <td className={`px-4 ${rowPadding} ${textCls} text-[var(--text-secondary)] tabular-nums`}>{lead._count.outreachMessages}</td>
                                            <td className={`px-4 ${rowPadding}`}><span className={`${textCls} tabular-nums font-medium ${lead._count.replies > 0 ? "text-emerald-400" : "text-[var(--text-muted)]"}`}>{lead._count.replies}</span></td>
                                            <td className={`px-4 ${rowPadding}`}>
                                                <svg className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
                    <div className="max-w-2xl mx-auto py-16 px-6">
                        <div className="bg-[var(--navy-mid)] border border-[var(--border)] rounded-2xl p-8 shadow-xl text-center space-y-6">
                            <div className="w-12 h-12 rounded-full bg-[var(--surface-2)] flex items-center justify-center text-[var(--text-muted)] mx-auto">
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                            </div>
                            <div className="space-y-1">
                                <h3 className="text-base font-semibold text-[var(--text-primary)]">Setup Checklist: Getting Your First Leads</h3>
                                <p className="text-xs text-[var(--text-muted)]">Complete these steps to discover and qualify high-priority prospects.</p>
                            </div>
                            <div className="text-left max-w-md mx-auto space-y-3 bg-[var(--surface)] border border-[var(--border)] p-5 rounded-xl">
                                <div className="flex items-center gap-3">
                                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${isIcpDone ? "bg-emerald-400/20 text-emerald-400 border border-emerald-400/30" : "bg-[var(--surface-2)] text-[var(--text-muted)] border border-[var(--border)]"}`}>
                                        {isIcpDone ? "✓" : "1"}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className={`text-xs font-semibold ${isIcpDone ? "text-[var(--text-muted)] line-through" : "text-[var(--text-primary)]"}`}>Define your Ideal Customer Profile (ICP)</p>
                                    </div>
                                    {!isIcpDone && (
                                        <Link href={`/dashboard/campaigns/${campaignId}/edit`} className="text-[10px] text-[var(--red)] hover:underline font-medium">
                                            Configure →
                                        </Link>
                                    )}
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${isSenderDone ? "bg-emerald-400/20 text-emerald-400 border border-emerald-400/30" : "bg-[var(--surface-2)] text-[var(--text-muted)] border border-[var(--border)]"}`}>
                                        {isSenderDone ? "✓" : "2"}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className={`text-xs font-semibold ${isSenderDone ? "text-[var(--text-muted)] line-through" : "text-[var(--text-primary)]"}`}>Link a sending channel (Email / LinkedIn)</p>
                                    </div>
                                    {!isSenderDone && (
                                        <Link href={`/dashboard/campaigns/${campaignId}/edit`} className="text-[10px] text-[var(--red)] hover:underline font-medium">
                                            Link Channel →
                                        </Link>
                                    )}
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${isDiscoveryDone ? "bg-emerald-400/20 text-emerald-400 border border-emerald-400/30" : "bg-[var(--surface-2)] text-[var(--text-muted)] border border-[var(--border)]"}`}>
                                        {isDiscoveryDone ? "✓" : "3"}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className={`text-xs font-semibold ${isDiscoveryDone ? "text-[var(--text-muted)] line-through" : "text-[var(--text-primary)]"}`}>Trigger lead discovery and pipeline scoring</p>
                                    </div>
                                    {!isDiscoveryDone && (
                                        <button
                                            id="btn-checklist-discover"
                                            onClick={handleDiscover}
                                            disabled={isDiscovering}
                                            className="text-[10px] text-sky-400 hover:underline font-medium disabled:opacity-50 focus-visible:outline-none"
                                        >
                                            {isDiscovering ? (
                                                <span className="inline-flex items-center gap-1">
                                                    <svg className="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                                                    Queuing…
                                                </span>
                                            ) : "Discover →"}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <div className="flex items-center justify-between px-6 py-3 border-t border-[var(--border)] bg-[var(--navy-mid)] flex-shrink-0">
                <span className="text-xs text-[var(--text-muted)]">Showing {leads.length} of {meta.total} leads</span>
                <div className="flex items-center gap-1">
                    <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] text-[var(--text-muted)] disabled:opacity-40 hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]">← Prev</button>
                    {Array.from({ length: Math.min(meta.totalPages, 5) }, (_, i) => i + 1).map((p) => (
                        <button key={p} onClick={() => setPage(p)} className={`px-3 py-1.5 text-xs rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] ${p === page ? "bg-[var(--red-glow)] text-[var(--red)] border-[var(--border-red)] font-medium" : "border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"}`}>{p}</button>
                    ))}
                    <button disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] text-[var(--text-secondary)] disabled:opacity-40 hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]">Next →</button>
                </div>
            </div>

            {detailLead && (
                <LeadDetailModal
                    lead={detailLead}
                    onClose={() => setDetailLead(null)}
                    onRefresh={fetchLeads}
                />
            )}
        </div>
    );
}