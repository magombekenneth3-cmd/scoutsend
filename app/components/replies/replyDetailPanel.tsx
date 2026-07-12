"use client";

import { useState, useRef, useEffect } from "react";

import type { Reply } from "@/app/api/src/lib/reply/replyTypes";
import { INTENT_CONFIG } from "@/app/api/src/lib/reply/replyConfig";
import { formatTimeAgo, getAvatarGradient, getInitials } from "@/app/api/src/lib/reply/reply.utils";
import { SentimentBar } from "./SentimentBar";
import { ConfidencePill } from "./confidencePill";
import { patchReply, sendReplyDraft } from "@/app/api/replies/replyApi";

/* EnrichedReply augments the base Reply type with intelligence fields that the
   classifier adds at runtime and that come back in the API response payload. */
interface EnrichedReply extends Reply {
    painPoints?: string[] | null;
    competitorsMentioned?: string[] | null;
    buyingStage?: string | null;
}

interface ReplyDetailPanelProps {
    reply: EnrichedReply;
    onClose: () => void;
    onMarkReviewed: (id: string) => void;
    onDraftSent: (id: string) => void;
}

const BUYING_STAGE_CFG: Record<string, { label: string; color: string }> = {
    RESEARCHING:  { label: "Researching",  color: "text-sky-400 bg-sky-400/10 border-sky-400/20" },
    EVALUATING:   { label: "Evaluating",   color: "text-violet-400 bg-violet-400/10 border-violet-400/20" },
    HOT:          { label: "Hot — Ready",  color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" },
    DISQUALIFIED: { label: "Disqualified", color: "text-[var(--red)] bg-[var(--red-glow)] border-[var(--border-red)]" },
    UNKNOWN:      { label: "Unknown",      color: "text-[var(--text-muted)] bg-[var(--surface-2)] border-[var(--border)]" },
};

function AISignalsCard({ reply }: { reply: EnrichedReply }) {
    const hasPainPoints   = (reply.painPoints?.length ?? 0) > 0;
    const hasCompetitors  = (reply.competitorsMentioned?.length ?? 0) > 0;
    const hasBuyingStage  = Boolean(reply.buyingStage);
    const hasObjection    = Boolean(reply.objectionCategory);

    if (!hasPainPoints && !hasCompetitors && !hasBuyingStage && !hasObjection) return null;

    const stageCfg = reply.buyingStage
        ? (BUYING_STAGE_CFG[reply.buyingStage] ?? BUYING_STAGE_CFG.UNKNOWN)
        : null;

    return (
        <div className="rounded-lg bg-[var(--surface-2)] border border-[var(--border)] p-3 space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">AI Signal Extraction</p>

            {hasBuyingStage && stageCfg && (
                <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--text-muted)]">Buying stage</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${stageCfg.color}`}>
                        {stageCfg.label}
                    </span>
                </div>
            )}

            {hasPainPoints && (
                <div className="space-y-1.5">
                    <p className="text-[10px] text-[var(--text-muted)]">Pain points identified</p>
                    <div className="flex flex-wrap gap-1.5">
                        {reply.painPoints!.map((pt) => (
                            <span key={pt} className="text-[10px] font-medium px-2 py-0.5 rounded-full border text-amber-400 bg-amber-400/10 border-amber-400/20">
                                {pt}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {hasCompetitors && (
                <div className="space-y-1.5">
                    <p className="text-[10px] text-[var(--text-muted)] flex items-center gap-1">
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[var(--red)]" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                        Competitors mentioned
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                        {reply.competitorsMentioned!.map((comp) => (
                            <span key={comp} className="text-[10px] font-semibold px-2 py-0.5 rounded-full border text-[var(--red)] bg-[var(--red-glow)] border-[var(--border-red)]">
                                ⚠ {comp}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {hasObjection && (
                <div className="flex items-center justify-between pt-1 border-t border-[var(--border)]">
                    <span className="text-[10px] text-[var(--text-muted)]">Objection type</span>
                    <span className="text-[10px] font-medium text-[var(--text-secondary)]">{reply.objectionCategory}</span>
                </div>
            )}
        </div>
    );
}

function OutreachThreadDrawer({ message }: { message: EnrichedReply["outreachMessage"] }) {
    const [open, setOpen] = useState(false);

    const label = message.isFollowUp
        ? `Follow-up #${message.followUpStep ?? ""}`
        : "Initial outreach";

    const sentLabel = message.sentAt
        ? new Date(message.sentAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
        : null;

    return (
        <div className="rounded-lg bg-[var(--surface-2)] border border-[var(--border)] overflow-hidden">
            {/* Header — always visible */}
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className="w-full flex items-start justify-between gap-3 p-3 text-left hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] focus-visible:ring-inset"
            >
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                            Original outreach
                        </p>
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border leading-none ${
                            message.isFollowUp
                                ? "bg-sky-400/10 border-sky-400/20 text-sky-400"
                                : "bg-[var(--red-glow)] border-[var(--border-red)] text-[var(--red)]"
                        }`}>
                            {label}
                        </span>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] truncate font-medium">
                        {message.subject || "(no subject)"}
                    </p>
                    {sentLabel && (
                        <p className="text-[10px] text-[var(--text-muted)] mt-0.5 tabular-nums">
                            Sent {sentLabel}
                        </p>
                    )}
                </div>
                {/* Chevron */}
                <svg
                    width="12" height="12" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="2.5"
                    strokeLinecap="round" strokeLinejoin="round"
                    className={`flex-shrink-0 mt-0.5 text-[var(--text-muted)] transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                    aria-hidden="true"
                >
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </button>

            {/* Expanded body */}
            {open && (
                <div className="border-t border-[var(--border)] px-3 py-3 bg-[var(--navy-mid)]">
                    <p className="text-xs text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap break-words">
                        {message.body || <span className="text-[var(--text-muted)] italic">No body content</span>}
                    </p>
                </div>
            )}
        </div>
    );
}

export function ReplyDetailPanel({ reply, onClose, onMarkReviewed, onDraftSent }: ReplyDetailPanelProps) {

    const cfg              = INTENT_CONFIG[reply.intent];
    const [marking, setMarking]       = useState(false);
    const [sending, setSending]       = useState(false);
    const [sendError, setSendError]   = useState<string | null>(null);
    const [editing, setEditing]       = useState(false);
    const [editedDraft, setEditedDraft] = useState(reply.draftBody ?? "");
    const [savingDraft, setSavingDraft] = useState(false);
    const textareaRef                 = useRef<HTMLTextAreaElement>(null);

    const hasDraft        = Boolean(reply.draftBody);
    const draftAlreadySent = Boolean(reply.draftSentAt);
    const isDirty         = editedDraft !== (reply.draftBody ?? "");

    useEffect(() => {
        setEditedDraft(reply.draftBody ?? "");
        setEditing(false);
        setSendError(null);
    }, [reply.id, reply.draftBody]);

    useEffect(() => {
        if (editing && textareaRef.current) {
            const el = textareaRef.current;
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight}px`;
            el.focus();
        }
    }, [editing]);

    function handleTextareaInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
        setEditedDraft(e.target.value);
        e.target.style.height = "auto";
        e.target.style.height = `${e.target.scrollHeight}px`;
    }

    async function handleMarkReviewed() {
        setMarking(true);
        try {
            await patchReply(reply.id, { requiresHumanReview: false });
            onMarkReviewed(reply.id);
        } finally {
            setMarking(false);
        }
    }

    async function handleSendDraft() {
        setSending(true);
        setSendError(null);
        try {
            if (isDirty) {
                setSavingDraft(true);
                await patchReply(reply.id, { draftBody: editedDraft });
                setSavingDraft(false);
            }
            await sendReplyDraft(reply.id);
            if (reply.requiresHumanReview) {
                await patchReply(reply.id, { requiresHumanReview: false });
                onMarkReviewed(reply.id);
            }
            onDraftSent(reply.id);
        } catch (err) {
            setSendError((err as Error).message ?? "Failed to send draft");
        } finally {
            setSending(false);
            setSavingDraft(false);
        }
    }

    return (
        <div className="flex flex-col h-full bg-[var(--surface)] border-l border-[var(--border)] overflow-hidden">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] flex-shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} aria-hidden="true" />
                    <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
                        {reply.lead.firstName} {reply.lead.lastName}
                    </span>
                    {reply.requiresHumanReview && (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-400/10 border border-amber-400/20 text-amber-400 flex-shrink-0">
                            Needs Review
                        </span>
                    )}
                    {draftAlreadySent && (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex-shrink-0">
                            Draft Sent
                        </span>
                    )}
                </div>
                <button
                    onClick={onClose}
                    aria-label="Close detail panel"
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] flex-shrink-0"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

                {/* Lead card */}
                <div className="rounded-lg bg-[var(--surface-2)] border border-[var(--border)] p-4 space-y-2.5">
                    <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">Lead</p>
                    <div className="flex items-center gap-3">
                        <div
                            className={`w-9 h-9 rounded-full bg-gradient-to-br ${getAvatarGradient(reply.lead.id)} flex items-center justify-center text-xs font-bold text-white flex-shrink-0`}
                            aria-hidden="true"
                        >
                            {getInitials(reply.lead.firstName ?? "", reply.lead.lastName ?? "")}
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm font-medium text-[var(--text-primary)] truncate">{reply.lead.firstName} {reply.lead.lastName}</p>
                            <p className="text-xs text-[var(--text-muted)] truncate">{reply.lead.email}</p>
                            <p className="text-xs text-[var(--text-secondary)] truncate">{reply.lead.companyName}</p>
                        </div>
                    </div>
                </div>

                {/* Sentiment + Confidence */}
                <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg bg-[var(--surface-2)] border border-[var(--border)] p-3 space-y-1.5">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Sentiment</p>
                        <SentimentBar score={reply.sentimentScore ?? null} />
                    </div>
                    <div className="rounded-lg bg-[var(--surface-2)] border border-[var(--border)] p-3 space-y-1.5">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Confidence</p>
                        <div className="pt-0.5">
                            <ConfidencePill confidence={reply.confidence ?? null} />
                        </div>
                    </div>
                </div>

                {/* Intent */}
                <div className="rounded-lg bg-[var(--surface-2)] border border-[var(--border)] p-3 flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Intent</p>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.badge}`}>{cfg.label}</span>
                </div>

                {/* AI Signal Extraction card */}
                <AISignalsCard reply={reply} />

                {/* Outreach thread — collapsible */}
                <OutreachThreadDrawer message={reply.outreachMessage} />

                {/* Reply body */}
                <div className="space-y-2">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Reply body</p>
                    <div className="rounded-lg border border-[var(--border)] bg-[var(--navy-mid)] p-4">
                        <p className="text-sm text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap break-words">
                            {reply.body}
                        </p>
                    </div>
                </div>

                {/* Draft reply — with inline editing */}
                {hasDraft && (
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Draft reply</p>
                            <div className="flex items-center gap-2">
                                {draftAlreadySent ? (
                                    <span className="text-[10px] text-emerald-400 font-medium">
                                        Sent {reply.draftSentAt ? formatTimeAgo(reply.draftSentAt) : ""}
                                    </span>
                                ) : !editing ? (
                                    <button
                                        onClick={() => setEditing(true)}
                                        className="text-[10px] font-medium text-[var(--text-muted)] hover:text-sky-400 inline-flex items-center gap-1 transition-colors focus-visible:outline-none"
                                    >
                                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                        Edit
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => { setEditing(false); setEditedDraft(reply.draftBody ?? ""); }}
                                        className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none"
                                    >
                                        Cancel
                                    </button>
                                )}
                            </div>
                        </div>
                        {reply.draftSubject && (
                            <p className="text-xs font-medium text-[var(--text-secondary)] truncate">Re: {reply.draftSubject}</p>
                        )}
                        {editing ? (
                            <div className="space-y-1.5">
                                <textarea
                                    ref={textareaRef}
                                    value={editedDraft}
                                    onChange={handleTextareaInput}
                                    className="w-full min-h-[100px] bg-[var(--navy-mid)] border border-[var(--border-red)] rounded-lg px-4 py-3 text-sm text-[var(--text-primary)] leading-relaxed resize-none focus:outline-none focus:ring-1 focus:ring-[var(--red)]/40 transition-colors duration-150 font-sans"
                                    aria-label="Edit draft reply"
                                />
                                {isDirty && (
                                    <p className="text-[10px] text-amber-400 flex items-center gap-1">
                                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                                        {savingDraft ? "Saving edits…" : "Unsaved edits — send to apply"}
                                    </p>
                                )}
                            </div>
                        ) : (
                            <div className={`rounded-lg border p-4 ${draftAlreadySent ? "border-emerald-500/20 bg-emerald-500/5" : "border-[var(--border)] bg-[var(--navy-mid)]"}`}>
                                <p className="text-sm text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap break-words">
                                    {editedDraft || reply.draftBody}
                                </p>
                            </div>
                        )}
                        {sendError && <p className="text-xs text-red-400">{sendError}</p>}
                    </div>
                )}

                <p className="text-xs text-[var(--text-muted)]">
                    Received {formatTimeAgo(reply.createdAt)} · {new Date(reply.createdAt).toLocaleString()}
                </p>
            </div>

            {/* Footer actions */}
            <div className="flex items-center gap-2 px-5 py-4 border-t border-[var(--border)] flex-shrink-0">
                {hasDraft && !draftAlreadySent && (
                    <button
                        onClick={handleSendDraft}
                        disabled={sending}
                        className="flex-1 flex items-center justify-center gap-2 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm font-medium hover:bg-blue-500/20 transition-colors duration-150 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                    >
                        {sending ? (
                            <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                        ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                        )}
                        {reply.requiresHumanReview ? (editing && isDirty ? "Save & Send" : "Approve & Send") : (editing && isDirty ? "Save & Send" : "Send Draft")}
                    </button>
                )}
                {reply.requiresHumanReview && !hasDraft && (
                    <button
                        onClick={handleMarkReviewed}
                        disabled={marking}
                        className="flex-1 flex items-center justify-center gap-2 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm font-medium hover:bg-emerald-500/20 transition-colors duration-150 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                    >
                        {marking ? (
                            <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                        ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                        )}
                        Mark Reviewed
                    </button>
                )}
                <a
                    href={`/dashboard/leads?highlight=${reply.lead.id}`}
                    className="flex-1 flex items-center justify-center gap-2 h-9 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-secondary)] text-sm font-medium hover:text-[var(--text-primary)] hover:border-[var(--border-red)] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                    </svg>
                    View Lead
                </a>
            </div>
        </div>
    );
}