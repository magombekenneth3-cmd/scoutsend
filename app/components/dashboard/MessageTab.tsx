"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "../../hooks/useToast";
import { ToastRegion } from "./ToastRegion";
import { formatDate } from "../../hooks/formatDate";

type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";
type DeliveryState = "DRAFT" | "QUEUED" | "SENT" | "DELIVERED" | "OPENED" | "REPLIED" | "BOUNCED" | "FAILED" | "SPAM";

interface Message {
    id: string;
    subject: string;
    subjectVariant?: string | null;
    body: string;
    originalSubject?: string;
    originalBody?: string;
    approvalStatus: ApprovalStatus;
    deliveryState: DeliveryState;
    spamRiskScore: number | null;
    personalizationScore: number | null;
    complianceIssues?: string[] | null;
    spamTriggers?: string[] | null;
    lead: { firstName: string | null; lastName: string | null; email: string | null; companyName: string };
    approvedBy?: { firstName: string; lastName: string } | null;
    sentAt: string | null;
    openedAt: string | null;
    createdAt: string;
    clicks?: number;
    isFollowUp?: boolean;
    followUpStep?: number | null;
    diffVector?: { followUpStrategy?: string; strategyReason?: string } | null;
}

interface MessagesMeta {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

const APPROVAL_CFG: Record<ApprovalStatus, { label: string; bg: string; text: string }> = {
    PENDING: { label: "Pending", bg: "bg-amber-400/10", text: "text-amber-400" },
    APPROVED: { label: "Approved", bg: "bg-emerald-400/10", text: "text-emerald-400" },
    REJECTED: { label: "Rejected", bg: "bg-[var(--red-glow)]", text: "text-[var(--red-text)]" },
};

const DELIVERY_CFG: Record<DeliveryState, { label: string; text: string }> = {
    DRAFT: { label: "Draft", text: "text-[var(--text-muted)]" },
    QUEUED: { label: "Queued", text: "text-sky-400" },
    SENT: { label: "Sent", text: "text-sky-400" },
    DELIVERED: { label: "Delivered", text: "text-sky-300" },
    OPENED: { label: "Opened", text: "text-violet-400" },
    REPLIED: { label: "Replied", text: "text-emerald-400" },
    BOUNCED: { label: "Bounced", text: "text-[var(--red-text)]" },
    FAILED: { label: "Failed", text: "text-[var(--red-text)]" },
    SPAM: { label: "Spam", text: "text-orange-400" },
};

const COMPLIANCE_LABELS: Record<string, { label: string; color: string }> = {
    MISSING_UNSUBSCRIBE: { label: "Missing unsubscribe link", color: "text-[var(--red-text)] bg-[var(--red-glow)] border-[var(--border-red)]" },
    GDPR_WARNING: { label: "GDPR data-processing warning", color: "text-[var(--red-text)] bg-[var(--red-glow)] border-[var(--border-red)]" },
    CASL_WARNING: { label: "CASL: Canadian region detected", color: "text-amber-400 bg-amber-400/10 border-amber-400/30" },
    HIGH_SPAM_RISK: { label: "High spam risk score", color: "text-[var(--red-text)] bg-[var(--red-glow)] border-[var(--border-red)]" },
    LEGAL_DISCLAIMER_MISSING: { label: "Legal disclaimer missing", color: "text-amber-400 bg-amber-400/10 border-amber-400/30" },
};

function resolveComplianceLabel(issue: string): { label: string; color: string } {
    if (COMPLIANCE_LABELS[issue]) return COMPLIANCE_LABELS[issue];
    if (issue.startsWith("UNFILLED_PLACEHOLDER:")) {
        const ph = issue.replace("UNFILLED_PLACEHOLDER:", "");
        return { label: `Unfilled placeholder: ${ph}`, color: "text-[var(--red-text)] bg-[var(--red-glow)] border-[var(--border-red)]" };
    }
    return { label: issue.replace(/_/g, " ").toLowerCase(), color: "text-amber-400 bg-amber-400/10 border-amber-400/30" };
}

function ComplianceBanner({ issues, triggers }: { issues: string[]; triggers: string[] }) {
    if (issues.length === 0 && triggers.length === 0) return null;
    return (
        <div className="px-5 pt-3 pb-0">
            <div className="rounded-lg border border-[var(--border-red)] bg-[var(--red-glow)] px-3 py-2.5 space-y-2">
                <div className="flex items-center gap-1.5">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--red-text)] flex-shrink-0" aria-hidden="true">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                        <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    <span className="text-xs font-semibold text-[var(--red-text)]">Compliance issues detected</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {issues.map((issue) => {
                        const cfg = resolveComplianceLabel(issue);
                        return (
                            <span key={issue} className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded border ${cfg.color}`}>
                                {cfg.label}
                            </span>
                        );
                    })}
                    {triggers.map((trigger) => (
                        <span key={trigger} className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded border text-amber-400 bg-amber-400/10 border-amber-400/30">
                            Spam trigger: &ldquo;{trigger}&rdquo;
                        </span>
                    ))}
                </div>
            </div>
        </div>
    );
}

function ScoreGauge({ label, score, inverted = false }: { label: string; score: number; inverted?: boolean }) {
    const good = inverted ? score <= 20 : score >= 75;
    const mid = inverted ? (score > 20 && score <= 45) : (score >= 50 && score < 75);
    const color = good ? "text-emerald-400" : mid ? "text-amber-400" : "text-[var(--red-text)]";
    const barColor = good ? "bg-emerald-400" : mid ? "bg-amber-400" : "bg-[var(--red)]";
    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)]">{label}</span>
                <span className={`text-xs font-bold tabular-nums ${color}`}>{score}</span>
            </div>
            <div className="h-1 w-full bg-[var(--surface-2)] rounded-full overflow-hidden">
                <div
                    className={`h-full rounded-full transition-[width] duration-500 ease-out ${barColor}`}
                    style={{ width: `${inverted ? (100 - score) : score}%` }}
                    role="progressbar" aria-valuenow={score} aria-valuemax={100} aria-label={label}
                />
            </div>
        </div>
    );
}

/* ── Inline word-level diff ────────────────────────────────────────────────── */

interface DiffSegment { text: string; added?: boolean; removed?: boolean }

function computeWordDiff(before: string, after: string): DiffSegment[] {
    const oldWords = before.split(/(\s+)/);
    const newWords = after.split(/(\s+)/);
    const m = oldWords.length, n = newWords.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--)
        for (let j = n - 1; j >= 0; j--)
            dp[i][j] = oldWords[i] === newWords[j]
                ? dp[i + 1][j + 1] + 1
                : Math.max(dp[i + 1][j], dp[i][j + 1]);

    const segs: DiffSegment[] = [];
    let i = 0, j = 0;
    while (i < m || j < n) {
        if (i < m && j < n && oldWords[i] === newWords[j]) {
            segs.push({ text: oldWords[i] });
            i++; j++;
        } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
            segs.push({ text: newWords[j], added: true });
            j++;
        } else {
            segs.push({ text: oldWords[i], removed: true });
            i++;
        }
    }
    // Merge consecutive same-type segments
    const merged: DiffSegment[] = [];
    for (const seg of segs) {
        const prev = merged[merged.length - 1];
        if (prev && !!prev.added === !!seg.added && !!prev.removed === !!seg.removed) {
            prev.text += seg.text;
        } else {
            merged.push({ ...seg });
        }
    }
    return merged;
}

function InlineDiff({ before, after }: { before: string; after: string }) {
    const segs = computeWordDiff(before, after);
    return (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--navy-mid)] p-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-2">Inline diff — AI edits</p>
            <p className="text-sm leading-relaxed font-sans whitespace-pre-wrap break-words">
                {segs.map((seg, i) => (
                    <span
                        key={i}
                        className={
                            seg.added ? "bg-emerald-400/20 text-emerald-300 rounded px-0.5" :
                                seg.removed ? "bg-red-400/20 text-red-300 line-through rounded px-0.5" :
                                    "text-[var(--text-secondary)]"
                        }
                    >
                        {seg.text}
                    </span>
                ))}
            </p>
        </div>
    );
}

/* ── Message Card ──────────────────────────────────────────────────────────── */

function MessageCard({
    message,
    senderEmail,
    onApprove,
    onReject,
    onSend,
    onSaveError,
}: {
    message: Message;
    senderEmail: string | null;
    onApprove: (id: string, editedSubject?: string, editedBody?: string) => void;
    onReject: (id: string) => void;
    onSend: (id: string) => void;
    onSaveError: (message: string) => void;
}) {
    const [showDiff, setShowDiff] = useState(false);
    const [editing, setEditing] = useState(false);
    const [editedSubject, setEditedSubject] = useState(message.subject);
    const [editedBody, setEditedBody] = useState(message.body);
    const [saving, setSaving] = useState(false);
    const [sending, setSending] = useState(false);
    const [viewMode, setViewMode] = useState<"text" | "mobile" | "desktop">("text");
    const [isPreview, setIsPreview] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const insertVariable = (variable: string) => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        const before = text.substring(0, start);
        const after = text.substring(end, text.length);
        const token = `{{${variable}}}`;
        const newText = before + token + after;
        setEditedBody(newText);
        setTimeout(() => {
            textarea.focus();
            textarea.selectionStart = textarea.selectionEnd = start + token.length;
        }, 0);
    };

    const renderPreview = (text: string) => {
        let rendered = text;
        const replacements: Record<string, string> = {
            firstName: message.lead.firstName || "",
            lastName: message.lead.lastName || "",
            company: message.lead.companyName || "",
            companyName: message.lead.companyName || "",
            title: "Prospect",
            website: "website.com",
        };
        Object.entries(replacements).forEach(([key, val]) => {
            const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "gi");
            rendered = rendered.replace(regex, val);
        });
        return rendered;
    };

    const highlightVariables = (text: string) => {
        const parts = text.split(/(\{\{[^}]+\}\}|\[[^\]]+\])/g);
        return parts.map((part, index) => {
            const isVar = (part.startsWith("{{") && part.endsWith("}}")) || (part.startsWith("[") && part.endsWith("]"));
            if (isVar) {
                return (
                    <span
                        key={index}
                        className="inline-block px-1.5 py-0.5 rounded border border-[var(--border-red)] bg-[var(--red-glow)] text-[var(--red-text)] font-semibold text-xs my-0.5"
                    >
                        {part}
                    </span>
                );
            }
            return part;
        });
    };

    const approvalCfg = APPROVAL_CFG[message.approvalStatus];
    const deliveryCfg = DELIVERY_CFG[message.deliveryState];
    const hasEdits = message.originalBody && message.originalBody !== message.body;
    const isDirty = editedSubject !== message.subject || editedBody !== message.body;
    const hasCompliance = (message.complianceIssues?.length ?? 0) > 0 || (message.spamTriggers?.length ?? 0) > 0;

    useEffect(() => {
        if (editing && textareaRef.current) {
            const el = textareaRef.current;
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight}px`;
            el.focus();
        }
    }, [editing]);

    function handleTextareaInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
        setEditedBody(e.target.value);
        e.target.style.height = "auto";
        e.target.style.height = `${e.target.scrollHeight}px`;
    }

    async function handleSaveAndApprove() {
        setSaving(true);
        try {
            if (isDirty) {
                const res = await fetch(`/api/outreach-messages/${message.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        ...(editedSubject !== message.subject && { subject: editedSubject }),
                        ...(editedBody !== message.body && { body: editedBody }),
                    }),
                });
                if (!res.ok) {
                    const errBody = await res.json().catch(() => null);
                    const status = res.status;
                    if (status === 429) {
                        onSaveError("Too many requests — please wait a moment and try again.");
                    } else if (status === 409) {
                        onSaveError("This message has already been approved. Please reload.");
                    } else if (status === 401 || status === 403) {
                        onSaveError("You don't have permission to edit this message.");
                    } else {
                        onSaveError(errBody?.error ?? "Save failed — please try again.");
                    }
                    return; // keep edit mode open; do not call onApprove
                }
            }
            onApprove(message.id, editedSubject !== message.subject ? editedSubject : undefined, editedBody !== message.body ? editedBody : undefined);
            setEditing(false);
        } catch {
            // Network error or JSON parse failure
            onSaveError("Unable to save — check your connection and try again.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <article className={[
            "bg-[var(--surface)] border rounded-xl overflow-hidden transition-all duration-200",
            message.approvalStatus === "PENDING"
                ? "border-amber-400/20 shadow-[0_0_0_1px_rgba(251,191,36,0.1)]"
                : "border-[var(--border)]",
        ].join(" ")}>

            {/* Header */}
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--border)]">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[var(--navy-deep)] to-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center text-xs font-bold text-[var(--text-secondary)] flex-shrink-0">
                            {(message.lead.firstName?.[0] ?? message.lead.companyName[0]).toUpperCase()}
                        </div>
                        <span className="text-sm font-semibold text-[var(--text-primary)]">{message.lead.firstName} {message.lead.lastName}</span>
                        <span className="text-xs text-[var(--text-muted)]">·</span>
                        <span className="text-xs text-[var(--text-secondary)]">{message.lead.companyName}</span>
                        {message.lead.email && (<><span className="text-xs text-[var(--text-muted)]">·</span><span className="text-xs text-[var(--text-muted)]">{message.lead.email}</span></>)}
                    </div>
                    <p className="text-sm font-medium text-[var(--text-primary)] truncate">{message.subject}</p>
                    {message.subjectVariant && (
                        <div className="mt-1 inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded border bg-amber-400/10 border-amber-400/20 text-amber-400">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 20.5L12 15l-6 5.5V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z" /></svg>
                            A/B: {message.subjectVariant}
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full ${approvalCfg.bg} ${approvalCfg.text}`}>{approvalCfg.label}</span>
                    {message.deliveryState !== "DRAFT" && <span className={`text-xs font-medium ${deliveryCfg.text}`}>{deliveryCfg.label}</span>}
                    {!!message.clicks && message.clicks > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-violet-400" title={`Clicked ${message.clicks} time${message.clicks === 1 ? "" : "s"}`}>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 9l10.5-3-3 10.5-2.5-4.5L9 9z" /></svg>
                            {message.clicks}
                        </span>
                    )}
                </div>
            </div>

            {message.isFollowUp && message.diffVector?.followUpStrategy && (
                <div
                    className="px-5 py-2 border-b border-[var(--border)] bg-[var(--surface-2)]/30 text-xs text-[var(--text-muted)]"
                    title={message.diffVector.strategyReason ?? undefined}
                >
                    Follow-up{message.followUpStep ? ` #${message.followUpStep}` : ""} strategy: <span className="text-[var(--text-secondary)] font-medium">{message.diffVector.followUpStrategy}</span>
                </div>
            )}

            {/* Score gauges */}
            <div className="grid grid-cols-2 gap-4 px-5 py-3 border-b border-[var(--border)] bg-[var(--navy-mid)]">
                {message.personalizationScore != null && <ScoreGauge label="Personalisation" score={message.personalizationScore} />}
                {message.spamRiskScore != null && <ScoreGauge label="Spam Risk" score={message.spamRiskScore} inverted />}
            </div>

            {/* Compliance banner */}
            {hasCompliance && (
                <ComplianceBanner
                    issues={message.complianceIssues ?? []}
                    triggers={message.spamTriggers ?? []}
                />
            )}

            {/* View Mode Selector Tabs */}
            {!editing && (
                <div className="flex items-center justify-between px-5 pt-2 border-b border-[var(--border)] bg-[var(--surface)]">
                    <div className="flex items-center gap-1">
                        {(["text", "mobile", "desktop"] as const).map((mode) => (
                            <button
                                key={mode}
                                onClick={() => setViewMode(mode)}
                                className={[
                                    "px-3 py-1.5 text-xs font-semibold rounded-t-lg border-t border-x transition-all duration-150 cursor-pointer",
                                    viewMode === mode
                                        ? "bg-[var(--navy-mid)] text-[var(--red-text)] border-[var(--border)]"
                                        : "text-[var(--text-muted)] hover:text-[var(--text-primary)] border-transparent"
                                ].join(" ")}
                            >
                                {mode === "text" ? "Raw Text" : mode === "mobile" ? "Mobile View" : "Desktop View"}
                            </button>
                        ))}
                    </div>
                    <button
                        type="button"
                        onClick={() => setIsPreview(!isPreview)}
                        className={`mb-1 px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all duration-150 flex items-center gap-1.5 cursor-pointer ${isPreview
                                ? "bg-[var(--red-glow)] text-[var(--red-text)] border-[var(--border-red)]/20 font-bold"
                                : "bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border)] hover:border-[var(--text-muted)]"
                            }`}
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                        </svg>
                        {isPreview ? "Previewing Lead Data" : "Preview with Lead Data"}
                    </button>
                </div>
            )}

            {/* Body */}
            <div className="px-5 py-4 space-y-3">
                {/* Diff view */}
                {showDiff && hasEdits && !editing ? (
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest">AI Edits</span>
                            <button onClick={() => setShowDiff(false)} className="text-xs text-[var(--text-muted)] hover:text-[var(--red-text)] transition-colors focus-visible:outline-none focus-visible:underline">Hide diff</button>
                        </div>
                        <InlineDiff before={message.originalBody!} after={message.body} />
                    </div>
                ) : editing ? (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">Editing draft</span>
                            <button
                                onClick={() => { setEditing(false); setEditedSubject(message.subject); setEditedBody(message.body); }}
                                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none"
                            >
                                Cancel
                            </button>
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-[var(--text-muted)] uppercase font-semibold">Subject</label>
                            <input
                                type="text"
                                value={editedSubject}
                                onChange={(e) => setEditedSubject(e.target.value)}
                                className="w-full bg-[var(--navy-mid)] border border-[var(--border)] rounded px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-red)]"
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <div className="flex items-center justify-between mb-1">
                                <label className="text-[10px] text-[var(--text-muted)] uppercase font-semibold">Body</label>
                                <div className="flex items-center gap-1">
                                    {(["firstName", "lastName", "company", "title", "website"] as const).map((v) => (
                                        <button
                                            key={v}
                                            type="button"
                                            onClick={() => insertVariable(v)}
                                            className="px-2 py-0.5 text-[10px] font-semibold rounded bg-[var(--surface-2)] text-[var(--text-secondary)] border border-[var(--border)] hover:border-[var(--red)]/40 hover:text-[var(--red-text)] transition-all cursor-pointer"
                                        >
                                            {`{{${v}}}`}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <textarea
                                ref={textareaRef}
                                value={editedBody}
                                onChange={handleTextareaInput}
                                className="w-full min-h-[120px] bg-[var(--navy-mid)] border border-[var(--border)] rounded-lg px-4 py-3 text-sm text-[var(--text-primary)] leading-relaxed resize-none focus:outline-none focus:ring-1 focus:ring-[var(--red)]/40 transition-colors duration-150 font-sans"
                                aria-label="Edit draft message"
                            />
                        </div>
                        {isDirty && (
                            <p className="text-[10px] text-amber-400 flex items-center gap-1">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                                Unsaved edits — approve to save and queue
                            </p>
                        )}
                    </div>
                ) : (
                    <>
                        {viewMode === "text" && (
                            <>
                                <div className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed font-sans">
                                    {isPreview ? renderPreview(message.body) : highlightVariables(message.body)}
                                </div>
                                {hasEdits && !showDiff && (
                                    <button onClick={() => setShowDiff(true)} className="text-xs text-sky-400 hover:text-sky-300 inline-flex items-center gap-1 transition-colors focus-visible:outline-none focus-visible:underline">
                                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" /><polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" /></svg>
                                        View AI edits
                                    </button>
                                )}
                            </>
                        )}

                        {viewMode === "mobile" && (
                            <div className="mx-auto my-2 w-[280px] rounded-3xl border-8 border-[var(--surface-2)] bg-[var(--navy-mid)] overflow-hidden shadow-2xl relative">
                                <div className="h-4 w-28 bg-[var(--surface-2)] mx-auto rounded-b-xl absolute top-0 left-1/2 -translate-x-1/2 z-20" />
                                <div className="pt-6 pb-4 px-3 flex flex-col gap-2 h-[320px] overflow-y-auto text-[11px] text-[var(--text-secondary)]">
                                    <div className="border-b border-[var(--border)] pb-2 flex items-center gap-1.5">
                                        <div className="w-5 h-5 rounded-full bg-[var(--red-glow)] text-[var(--red-text)] font-bold flex items-center justify-center text-[9px] flex-shrink-0">
                                            {(senderEmail?.[0] ?? "S").toUpperCase()}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="font-semibold text-[var(--text-primary)] truncate leading-none mb-0.5">
                                                {senderEmail ?? "Your Mailbox"}
                                            </p>
                                            <p className="text-[9px] text-[var(--text-muted)] truncate">
                                                To: {message.lead.email || `${message.lead.firstName ?? "lead"}@${message.lead.companyName.toLowerCase().replace(/\s+/g, "")}.com`}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="font-bold text-[var(--text-primary)] leading-tight">
                                        {isPreview ? renderPreview(message.subject) : message.subject}
                                    </div>
                                    <div className="whitespace-pre-wrap leading-relaxed font-sans text-[var(--text-secondary)] pt-1">
                                        {isPreview ? renderPreview(message.body) : highlightVariables(message.body)}
                                    </div>
                                </div>
                            </div>
                        )}

                        {viewMode === "desktop" && (
                            <div className="w-full border border-[var(--border)] rounded-lg bg-[var(--navy-mid)] overflow-hidden shadow-lg flex flex-col">
                                <div className="bg-[var(--surface-2)] border-b border-[var(--border)] px-4 py-2 flex items-center gap-1.5">
                                    <div className="w-2.5 h-2.5 rounded-full bg-[var(--red)] opacity-85" />
                                    <div className="w-2.5 h-2.5 rounded-full bg-amber-400 opacity-85" />
                                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 opacity-85" />
                                    <div className="mx-auto w-[60%] bg-[var(--navy)] text-[10px] text-[var(--text-muted)] py-0.5 rounded text-center truncate">
                                        {senderEmail ? (senderEmail.split("@")[1] ?? "mail.example.com") : "mail.example.com"}
                                    </div>
                                </div>
                                <div className="px-4 py-3 border-b border-[var(--border)] flex flex-col gap-1 text-[11px] text-[var(--text-muted)]">
                                    <p><strong className="text-[var(--text-secondary)]">From:</strong> {senderEmail ?? <span className="italic">No sender configured</span>}</p>
                                    <p><strong className="text-[var(--text-secondary)]">To:</strong> {message.lead.email || `${message.lead.firstName ?? "lead"}@${message.lead.companyName.toLowerCase().replace(/\s+/g, "")}.com`}</p>
                                    <p><strong className="text-[var(--text-secondary)]">Subject:</strong> <span className="text-[var(--text-primary)] font-medium">{isPreview ? renderPreview(message.subject) : message.subject}</span></p>
                                </div>
                                <div className="px-4 py-5 whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-secondary)] bg-[var(--surface)] min-h-[160px]">
                                    {isPreview ? renderPreview(message.body) : highlightVariables(message.body)}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* PENDING action footer */}
            {message.approvalStatus === "PENDING" && (
                <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--border)] bg-[var(--navy-mid)]">
                    <div className="flex items-center gap-2">
                        <p className="text-xs text-[var(--text-muted)]">Created {formatDate(message.createdAt)}</p>
                        {!editing && (
                            <button
                                onClick={() => setEditing(true)}
                                className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-sky-400 transition-colors focus-visible:outline-none"
                                aria-label="Edit draft"
                            >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                Edit
                            </button>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => onReject(message.id)}
                            disabled={saving}
                            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--red-text)] hover:border-[var(--border-red)] hover:bg-[var(--red-glow)] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] disabled:opacity-40"
                            aria-label={`Reject message to ${message.lead.companyName}`}
                        >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                            Reject
                        </button>
                        <button
                            onClick={editing ? handleSaveAndApprove : () => onApprove(message.id)}
                            disabled={saving}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 active:scale-[0.97] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-50"
                            aria-label={`Approve message to ${message.lead.companyName}`}
                        >
                            {saving ? (
                                <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                            ) : (
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
                            )}
                            {editing && isDirty ? "Save & Approve" : "Approve"}
                        </button>
                    </div>
                </div>
            )}

            {/* APPROVED footer */}
            {message.approvalStatus === "APPROVED" && (
                <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--border)] bg-[var(--navy-mid)]">
                    <span className="text-xs text-[var(--text-muted)]">
                        Approved by {message.approvedBy?.firstName} {message.approvedBy?.lastName}
                    </span>
                    <div className="flex items-center gap-2">
                        {message.sentAt && <span className="text-xs text-[var(--text-muted)]">Sent {formatDate(message.sentAt)}</span>}
                        {(message.deliveryState === "QUEUED" || message.deliveryState === "FAILED") && (
                            <button
                                id={`btn-send-now-${message.id}`}
                                onClick={() => {
                                    setSending(true);
                                    onSend(message.id);
                                }}
                                disabled={sending}
                                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-[var(--red)] text-white hover:bg-[var(--red-dim)] active:scale-[0.97] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] disabled:opacity-50"
                                aria-label={`Send message to ${message.lead.companyName} now`}
                            >
                                {sending ? (
                                    <svg className="animate-spin" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                                ) : (
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                                )}
                                {sending ? "Sending…" : "Send Now"}
                            </button>
                        )}
                    </div>
                </div>
            )}
        </article>
    );
}

// ── Inline error classification (mirrors replyApi pattern) ──────────────────

type MsgErrorKind =
    | "RATE_LIMITED"
    | "UNAUTHORIZED"
    | "FORBIDDEN"
    | "SERVER_ERROR"
    | "UNAVAILABLE"
    | "NETWORK_ERROR";

interface MsgApiError {
    kind: MsgErrorKind;
    retryAfterSeconds: number | null;
    userMessage: string;
}

function parseRetryAfter(headers: Headers): number | null {
    const raw = headers.get("retry-after");
    if (!raw) return null;
    const seconds = parseInt(raw, 10);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds, 300);
    const date = Date.parse(raw);
    if (Number.isFinite(date)) {
        const diff = Math.ceil((date - Date.now()) / 1000);
        return diff > 0 ? Math.min(diff, 300) : null;
    }
    return null;
}

function classifyMsgError(status: number, headers: Headers): MsgApiError {
    switch (status) {
        case 401:
            return { kind: "UNAUTHORIZED", retryAfterSeconds: null, userMessage: "Session expired. Please sign in again." };
        case 403:
            return { kind: "FORBIDDEN", retryAfterSeconds: null, userMessage: "You don't have permission to view these messages." };
        case 429: {
            const retryAfterSeconds = parseRetryAfter(headers) ?? 30;
            return { kind: "RATE_LIMITED", retryAfterSeconds, userMessage: "Messages are temporarily paused due to high activity." };
        }
        case 502:
        case 503:
        case 504:
            return { kind: "UNAVAILABLE", retryAfterSeconds: null, userMessage: "The server is temporarily unavailable." };
        default:
            return { kind: "SERVER_ERROR", retryAfterSeconds: null, userMessage: "Something went wrong loading messages. Please try again." };
    }
}

const MAX_MSG_AUTO_RETRIES = 3;
const MSG_BACKOFF_JITTER_MS = 1_000;
const MSG_UNAVAILABLE_BASE_MS = 5_000;

function withMsgJitter(ms: number): number {
    return ms + Math.floor(Math.random() * MSG_BACKOFF_JITTER_MS);
}

type FilterTab = "ALL" | "PENDING" | "APPROVED" | "REJECTED";

interface MessagesTabProps {
    campaignId: string;
    onSendComplete?: () => void;
}

export function MessagesTab({ campaignId, onSendComplete }: MessagesTabProps) {
    const router = useRouter();
    const [messages, setMessages] = useState<Message[]>([]);
    const [meta, setMeta] = useState<MessagesMeta>({ total: 0, page: 1, limit: 20, totalPages: 1 });
    const [initialLoading, setInitialLoading] = useState(true);
    const [initialError, setInitialError] = useState<MsgApiError | null>(null);
    const [refreshError, setRefreshError] = useState<MsgApiError | null>(null);
    const [retryCountdown, setRetryCountdown] = useState<number | null>(null);
    const [filter, setFilter] = useState<FilterTab>("ALL");
    const [page, setPage] = useState(1);
    const [senderEmail, setSenderEmail] = useState<string | null>(null);
    const { toasts, addToast, dismiss } = useToast();
    const [statusCounts, setStatusCounts] = useState<{ PENDING: number; APPROVED: number; REJECTED: number }>({
        PENDING: 0, APPROVED: 0, REJECTED: 0,
    });
    const [bulkApproving, setBulkApproving] = useState(false);

    const hasData = messages.length > 0;
    const inFlightRef = useRef<AbortController | null>(null);
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const retryCountRef = useRef(0);
    const isInitialRef = useRef(true);

    async function handleApproveAllVisible() {
        const pendingIds = messages.filter(m => m.approvalStatus === "PENDING").map(m => m.id);
        if (pendingIds.length === 0) return;
        setBulkApproving(true);
        const snapshot = messages;
        setMessages(prev => prev.map(m => pendingIds.includes(m.id) ? { ...m, approvalStatus: "APPROVED" as ApprovalStatus } : m));
        try {
            const res = await fetch("/api/outreach-messages/batch-approve", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ campaignId, messageIds: pendingIds }),
            });
            if (!res.ok) throw new Error("Bulk approval failed");
            addToast("success", `${pendingIds.length} messages approved`);
            fetchStatusCounts();
        } catch {
            setMessages(snapshot);
            addToast("error", "Bulk approval failed — please try again");
        } finally {
            setBulkApproving(false);
        }
    }

    const cancelInFlight = useCallback(() => {
        inFlightRef.current?.abort();
        inFlightRef.current = null;
        if (retryTimerRef.current !== null) {
            clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
        }
        if (countdownTimerRef.current !== null) {
            clearInterval(countdownTimerRef.current);
            countdownTimerRef.current = null;
        }
    }, []);

    const fetchMessages = useCallback(async (opts?: { campaignId: string; filter: FilterTab; page: number }) => {
        const params = new URLSearchParams({
            campaignId: opts?.campaignId ?? campaignId,
            page: String(opts?.page ?? page),
            limit: "20",
            ...((opts?.filter ?? filter) !== "ALL" && { approvalStatus: opts?.filter ?? filter }),
        });

        cancelInFlight();
        const controller = new AbortController();
        inFlightRef.current = controller;

        const isInitial = isInitialRef.current;
        if (isInitial) {
            setInitialLoading(true);
            setInitialError(null);
        }
        setRefreshError(null);

        try {
            const res = await fetch(`/api/outreach-messages?${params}`, { signal: controller.signal });
            if (controller.signal.aborted) return;
            if (!res.ok) {
                const err = classifyMsgError(res.status, res.headers);
                if (err.kind === "UNAUTHORIZED") {
                    router.replace("/auth/login");
                    return;
                }
                if (isInitial && !hasData) {
                    setInitialError(err);
                } else {
                    setRefreshError(err);
                    scheduleAutoRetry(err);
                }
                return;
            }
            const json = await res.json();
            if (controller.signal.aborted) return;
            setMessages(json.data);
            setMeta(json.meta);
            setInitialError(null);
            setRefreshError(null);
            retryCountRef.current = 0;
        } catch {
            if (controller.signal.aborted) return;
            const err: MsgApiError = {
                kind: "NETWORK_ERROR",
                retryAfterSeconds: null,
                userMessage: "Unable to reach the server. Check your connection.",
            };
            if (isInitial && !hasData) {
                setInitialError(err);
            } else {
                setRefreshError(err);
                scheduleAutoRetry(err);
            }
        } finally {
            if (!controller.signal.aborted) {
                setInitialLoading(false);
                inFlightRef.current = null;
                isInitialRef.current = false;
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [campaignId, filter, page, cancelInFlight, hasData, router]);

    function scheduleAutoRetry(err: MsgApiError) {
        if (retryCountRef.current >= MAX_MSG_AUTO_RETRIES) return;
        const isTransient = err.kind === "RATE_LIMITED" || err.kind === "UNAVAILABLE" || err.kind === "NETWORK_ERROR";
        if (!isTransient) return;

        let delayMs: number;
        if (err.kind === "RATE_LIMITED" && err.retryAfterSeconds !== null) {
            delayMs = withMsgJitter(err.retryAfterSeconds * 1000);
        } else {
            const backoff = MSG_UNAVAILABLE_BASE_MS * Math.pow(2, retryCountRef.current);
            delayMs = withMsgJitter(Math.min(backoff, 60_000));
        }

        retryCountRef.current += 1;
        let remaining = Math.ceil(delayMs / 1000);
        setRetryCountdown(remaining);
        countdownTimerRef.current = setInterval(() => {
            remaining -= 1;
            if (remaining <= 0) {
                clearInterval(countdownTimerRef.current!);
                countdownTimerRef.current = null;
                setRetryCountdown(null);
            } else {
                setRetryCountdown(remaining);
            }
        }, 1_000);

        retryTimerRef.current = setTimeout(async () => {
            retryTimerRef.current = null;
            if (inFlightRef.current) return;
            await fetchMessages();
        }, delayMs);
    }

    // Fetch the sender email address once per campaign for the emulator preview
    useEffect(() => {
        fetch(`/api/campaigns/${campaignId}`)
            .then(r => r.ok ? r.json() : null)
            .then((data: { senderMailbox?: { emailAddress?: string } } | null) => {
                setSenderEmail(data?.senderMailbox?.emailAddress ?? null);
            })
            .catch(() => { /* non-critical */ });
    }, [campaignId]);

    // On campaignId/filter/page change, mark as initial if nothing loaded yet
    useEffect(() => {
        retryCountRef.current = 0;
        fetchMessages();
        return () => cancelInFlight();
    }, [campaignId, filter, page]); // eslint-disable-line react-hooks/exhaustive-deps

    const fetchStatusCounts = useCallback(async () => {
        try {
            const res = await fetch(`/api/outreach-messages/counts?campaignId=${encodeURIComponent(campaignId)}`);
            if (!res.ok) return; // non-critical — stale counts are acceptable
            const data = await res.json();
            setStatusCounts({
                PENDING: data.PENDING ?? 0,
                APPROVED: data.APPROVED ?? 0,
                REJECTED: data.REJECTED ?? 0,
            });
        } catch {
            // non-critical
        }
    }, [campaignId]);

    useEffect(() => { fetchStatusCounts(); }, [fetchStatusCounts]);
    useEffect(() => { setPage(1); }, [filter]);

    async function handleApprove(id: string, editedSubject?: string, editedBody?: string) {
        const snapshot = messages;
        setMessages((prev) => prev.map((m) =>
            m.id === id
                ? {
                    ...m,
                    approvalStatus: "APPROVED" as ApprovalStatus,
                    ...(editedSubject ? { subject: editedSubject } : {}),
                    ...(editedBody ? { body: editedBody } : {})
                }
                : m
        ));
        try {
            const res = await fetch(`/api/outreach-messages/${id}/approve`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
            });
            if (!res.ok) throw new Error(`Server returned ${res.status}`);
            addToast("success", "Message approved");
            fetchStatusCounts();
        } catch {
            setMessages(snapshot);
            addToast("error", "Approval failed — please try again");
        }
    }

    async function handleSend(id: string) {
        try {
            const res = await fetch(`/api/outreach-messages/${id}/send`, { method: "POST" });
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new Error(body?.error ?? `Request failed (${res.status})`);
            }
            addToast("success", "Message sent");
            await fetchMessages();
            fetchStatusCounts();
            onSendComplete?.();
        } catch (err) {
            addToast("error", err instanceof Error ? err.message : "Send failed — please try again");
        }
    }

    async function handleReject(id: string) {
        const snapshot = messages;
        setMessages((prev) => prev.map((m) =>
            m.id === id ? { ...m, approvalStatus: "REJECTED" as ApprovalStatus } : m
        ));
        try {
            const res = await fetch(`/api/outreach-messages/${id}/reject`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
            });
            if (!res.ok) throw new Error(`Server returned ${res.status}`);
            addToast("success", "Message rejected");
            fetchStatusCounts();
        } catch {
            setMessages(snapshot);
            addToast("error", "Rejection failed — please try again");
        }
    }

    const counts: Record<FilterTab, number> = {
        ALL: meta.total,
        PENDING: statusCounts.PENDING,
        APPROVED: statusCounts.APPROVED,
        REJECTED: statusCounts.REJECTED,
    };

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-6 py-3 border-b border-[var(--border)] bg-[var(--navy-mid)] flex-shrink-0">
                <div className="flex items-center gap-1" role="tablist" aria-label="Filter messages">
                    {(["ALL", "PENDING", "APPROVED", "REJECTED"] as FilterTab[]).map((f) => (
                        <button
                            key={f}
                            role="tab"
                            aria-selected={filter === f}
                            onClick={() => setFilter(f)}
                            className={[
                                "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-150",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]",
                                filter === f
                                    ? "bg-[var(--red-glow)] text-[var(--red-text)] border border-[var(--border-red)]"
                                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)]",
                            ].join(" ")}
                        >
                            {f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()}
                            <span className={`text-xs tabular-nums rounded-full px-1.5 py-0.5 ${filter === f ? "bg-[var(--red)] text-white" : "bg-[var(--surface-2)] text-[var(--text-muted)]"}`}>
                                {counts[f]}
                            </span>
                        </button>
                    ))}
                </div>
                {messages.some(m => m.approvalStatus === "PENDING") && (
                    <button
                        onClick={handleApproveAllVisible}
                        disabled={bulkApproving}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 active:scale-[0.97] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-50 cursor-pointer"
                    >
                        {bulkApproving ? (
                            <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                        ) : (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
                        )}
                        Approve All Visible ({messages.filter(m => m.approvalStatus === "PENDING").length})
                    </button>
                )}
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
            {initialLoading ? (
                <div className="flex items-center justify-center py-20">
                    <svg className="animate-spin text-[var(--red-text)]" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                </div>
            ) : initialError ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
                    <p className="text-sm text-[var(--red-text)]">{initialError.userMessage}</p>
                    <button onClick={() => { retryCountRef.current = 0; isInitialRef.current = true; fetchMessages(); }} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] underline">Retry</button>
                </div>
            ) : (
                <div className="max-w-3xl mx-auto space-y-4">
                    {refreshError && (
                        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-[var(--border-red)] bg-[var(--red-glow)] text-[var(--red-text)] text-xs">
                            <span>{refreshError.userMessage}{retryCountdown !== null ? ` Retrying in ${retryCountdown}s…` : ""}</span>
                            <button
                                onClick={() => { cancelInFlight(); retryCountRef.current = 0; setRefreshError(null); setRetryCountdown(null); fetchMessages(); }}
                                disabled={retryCountdown !== null}
                                className="flex-shrink-0 underline disabled:no-underline disabled:opacity-50"
                            >
                                {retryCountdown !== null ? `${retryCountdown}s` : "Retry now"}
                            </button>
                        </div>
                    )}
                    {messages.map((m) => (
                        <MessageCard key={m.id} message={m} senderEmail={senderEmail} onApprove={handleApprove} onReject={handleReject} onSend={handleSend} onSaveError={(msg) => addToast("error", msg)} />
                    ))}
                    {messages.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
                            <div className="w-12 h-12 rounded-full bg-[var(--surface-2)] flex items-center justify-center text-[var(--text-muted)]">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
                            </div>
                            <p className="text-sm font-medium text-[var(--text-secondary)]">No messages</p>
                            <p className="text-xs text-[var(--text-muted)]">{filter === "PENDING" ? "All messages have been reviewed" : "Messages will appear here after the generate phase"}</p>
                        </div>
                    )}
                    {meta.totalPages > 1 && (
                        <div className="flex items-center justify-center gap-2 pt-4">
                            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] text-[var(--text-muted)] disabled:opacity-40 hover:bg-[var(--surface-2)] transition-colors">← Prev</button>
                            <span className="text-xs text-[var(--text-muted)]">Page {page} of {meta.totalPages}</span>
                            <button disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] text-[var(--text-secondary)] disabled:opacity-40 hover:bg-[var(--surface-2)] transition-colors">Next →</button>
                        </div>
                    )}
                </div>
                )}
            </div>
            <ToastRegion toasts={toasts} onDismiss={dismiss} />
        </div>
    );
}