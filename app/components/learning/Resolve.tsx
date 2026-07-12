"use client";

import { useState, useEffect, useRef } from "react";

import { FullDiffView } from "@/app/components/learning/DiffView";
import { LearningEventDetail } from "@/app/api/learning/learningApi";
import { EventTypeBadge, OutcomeBadge } from "./learningBadge";

interface ResolvePanelProps {
    eventId: string | null;
    detail: LearningEventDetail | null;
    detailLoading: boolean;
    detailError: string | null;
    actionError: string | null;
    actionSuccess: string | null;
    isPending: boolean;
    onResolve: (
        id: string,
        data: { subject?: string; body?: string; reviewerNote?: string }
    ) => void;
    onDismiss: (id: string, reason: string) => void;
    onClose: () => void;
}

function PanelSkeleton() {
    return (
        <div className="space-y-5 p-5 animate-pulse" aria-busy="true" aria-label="Loading event detail">
            <div className="h-5 w-3/4 rounded bg-[var(--surface-2)]" />
            <div className="h-4 w-1/2 rounded bg-[var(--surface-2)]" />
            <div className="space-y-2">
                {[1, 0.9, 0.7, 0.8].map((w, i) => (
                    <div
                        key={i}
                        className="h-3 rounded bg-[var(--surface-2)]"
                        style={{ width: `${w * 100}%` }}
                    />
                ))}
            </div>
        </div>
    );
}

export function ResolvePanel({
    eventId,
    detail,
    detailLoading,
    detailError,
    actionError,
    actionSuccess,
    isPending,
    onResolve,
    onDismiss,
    onClose,
}: ResolvePanelProps) {
    const [editedSubject, setEditedSubject] = useState("");
    const [editedBody, setEditedBody] = useState("");
    const [reviewerNote, setReviewerNote] = useState("");
    const [dismissReason, setDismissReason] = useState("");
    const [showDismissForm, setShowDismissForm] = useState(false);
    const [expandDiff, setExpandDiff] = useState(false);
    const closeRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (detail?.outreachMessage) {
            setEditedSubject(detail.outreachMessage.subject);
            setEditedBody(detail.outreachMessage.body);
        }
        setReviewerNote("");
        setDismissReason("");
        setShowDismissForm(false);
        setExpandDiff(false);
    }, [detail]);

    if (!eventId) {
        return (
            <div className="flex flex-col items-center justify-center h-full px-8 text-center gap-3">
                <svg
                    width="36"
                    height="36"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-[var(--text-muted)]"
                    aria-hidden="true"
                >
                    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                </svg>
                <p className="text-sm text-[var(--text-muted)] leading-relaxed">
                    Select an event from the table to review it here
                </p>
            </div>
        );
    }

    const isPending_ = detail?.outcome === "PENDING_REVIEW";
    const canAct = isPending_ && !isPending;

    const handleResolve = () => {
        if (!eventId) return;
        const data: { subject?: string; body?: string; reviewerNote?: string } = {};
        const orig = detail?.outreachMessage;
        if (orig && editedSubject.trim() && editedSubject !== orig.subject) {
            data.subject = editedSubject.trim();
        }
        if (orig && editedBody.trim() && editedBody !== orig.body) {
            data.body = editedBody.trim();
        }
        if (reviewerNote.trim()) data.reviewerNote = reviewerNote.trim();
        if (!data.subject && !data.body) {
            data.subject = orig?.subject;
        }
        onResolve(eventId, data);
    };

    const handleDismiss = () => {
        if (!eventId || !dismissReason.trim()) return;
        onDismiss(eventId, dismissReason.trim());
    };

    return (
        <div
            className="flex flex-col h-full"
            role="region"
            aria-label="Event detail panel"
        >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] flex-shrink-0">
                <h2 className="text-sm font-semibold font-display text-[var(--text-primary)]">
                    Event Detail
                </h2>
                <button
                    ref={closeRef}
                    onClick={onClose}
                    aria-label="Close panel"
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                >
                    <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                    >
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                </button>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
                {detailLoading ? (
                    <PanelSkeleton />
                ) : detailError ? (
                    <div
                        role="alert"
                        className="m-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400"
                    >
                        {detailError}
                    </div>
                ) : detail ? (
                    <div className="p-5 space-y-5">
                        <div className="flex flex-wrap items-center gap-2">
                            <EventTypeBadge type={detail.eventType} />
                            <OutcomeBadge outcome={detail.outcome} />
                        </div>

                        {actionSuccess && (
                            <div
                                role="status"
                                className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400"
                            >
                                {actionSuccess}
                            </div>
                        )}
                        {actionError && (
                            <div
                                role="alert"
                                className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400"
                            >
                                {actionError}
                            </div>
                        )}

                        {detail.outreachMessage?.lead && (
                            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 space-y-0.5">
                                <p className="text-sm font-medium text-[var(--text-primary)]">
                                    {detail.outreachMessage.lead.firstName}{" "}
                                    {detail.outreachMessage.lead.lastName}
                                    {detail.outreachMessage.lead.title && (
                                        <span className="text-[var(--text-muted)]">
                                            {" · "}
                                            {detail.outreachMessage.lead.title}
                                        </span>
                                    )}
                                </p>
                                <p className="text-xs text-[var(--text-muted)]">
                                    {detail.outreachMessage.lead.companyName} ·{" "}
                                    {detail.outreachMessage.lead.email}
                                </p>
                            </div>
                        )}

                        {(detail.diffVector || detail.modifiedOutput) && (
                            <div>
                                <button
                                    onClick={() => setExpandDiff((v) => !v)}
                                    aria-expanded={expandDiff}
                                    className="flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] rounded"
                                >
                                    <svg
                                        width="12"
                                        height="12"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        className={`transition-transform duration-150 ${expandDiff ? "rotate-90" : ""}`}
                                        aria-hidden="true"
                                    >
                                        <polyline points="9 18 15 12 9 6" />
                                    </svg>
                                    AI Changes
                                </button>
                                {expandDiff && (
                                    <div className="mt-3">
                                        <FullDiffView
                                            originalOutput={detail.originalOutput}
                                            modifiedOutput={detail.modifiedOutput}
                                            diffVector={detail.diffVector}
                                        />
                                    </div>
                                )}
                            </div>
                        )}

                        {isPending_ && detail.outreachMessage && (
                            <div className="space-y-3">
                                <div>
                                    <label
                                        htmlFor="edit-subject"
                                        className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1.5"
                                    >
                                        Subject
                                    </label>
                                    <input
                                        id="edit-subject"
                                        type="text"
                                        value={editedSubject}
                                        onChange={(e) => setEditedSubject(e.target.value)}
                                        disabled={!canAct}
                                        className="w-full h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text-primary)] px-3 focus:outline-none focus:ring-2 focus:ring-[var(--red)] disabled:opacity-50 disabled:cursor-not-allowed"
                                        aria-label="Edit subject"
                                    />
                                </div>
                                <div>
                                    <label
                                        htmlFor="edit-body"
                                        className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1.5"
                                    >
                                        Body
                                    </label>
                                    <textarea
                                        id="edit-body"
                                        rows={8}
                                        value={editedBody}
                                        onChange={(e) => setEditedBody(e.target.value)}
                                        disabled={!canAct}
                                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text-primary)] px-3 py-2 resize-y focus:outline-none focus:ring-2 focus:ring-[var(--red)] disabled:opacity-50 disabled:cursor-not-allowed"
                                        aria-label="Edit body"
                                    />
                                </div>
                                <div>
                                    <label
                                        htmlFor="reviewer-note"
                                        className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1.5"
                                    >
                                        Reviewer note{" "}
                                        <span className="font-normal normal-case text-[var(--text-muted)]">
                                            (optional)
                                        </span>
                                    </label>
                                    <input
                                        id="reviewer-note"
                                        type="text"
                                        value={reviewerNote}
                                        onChange={(e) => setReviewerNote(e.target.value)}
                                        disabled={!canAct}
                                        maxLength={500}
                                        placeholder="Why this edit was made…"
                                        className="w-full h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] px-3 focus:outline-none focus:ring-2 focus:ring-[var(--red)] disabled:opacity-50 disabled:cursor-not-allowed"
                                        aria-label="Reviewer note"
                                    />
                                </div>
                            </div>
                        )}

                        {!isPending_ && detail.metadata && (
                            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 space-y-1.5">
                                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                                    Resolution Notes
                                </p>
                                {detail.metadata.reviewerNote && (
                                    <p className="text-sm text-[var(--text-secondary)]">
                                        {detail.metadata.reviewerNote}
                                    </p>
                                )}
                                {detail.metadata.dismissReason && (
                                    <p className="text-sm text-[var(--text-secondary)]">
                                        {detail.metadata.dismissReason}
                                    </p>
                                )}
                                {detail.metadata.resolvedAt && (
                                    <p className="text-xs text-[var(--text-muted)]">
                                        Resolved{" "}
                                        {new Intl.DateTimeFormat("en-US", {
                                            dateStyle: "medium",
                                            timeStyle: "short",
                                        }).format(new Date(detail.metadata.resolvedAt as string))}
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                ) : null}
            </div>

            {isPending_ && canAct && (
                <div className="flex-shrink-0 border-t border-[var(--border)] p-4 space-y-3">
                    {showDismissForm ? (
                        <div className="space-y-3">
                            <label
                                htmlFor="dismiss-reason"
                                className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider"
                            >
                                Dismiss reason{" "}
                                <span className="text-red-400" aria-hidden="true">*</span>
                            </label>
                            <input
                                id="dismiss-reason"
                                type="text"
                                value={dismissReason}
                                onChange={(e) => setDismissReason(e.target.value)}
                                maxLength={500}
                                placeholder="Reason for dismissing this event…"
                                className="w-full h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] px-3 focus:outline-none focus:ring-2 focus:ring-[var(--red)]"
                                aria-required="true"
                                aria-label="Dismiss reason"
                            />
                            <div className="flex gap-2">
                                <button
                                    onClick={handleDismiss}
                                    disabled={!dismissReason.trim() || isPending}
                                    aria-disabled={!dismissReason.trim() || isPending}
                                    className="flex-1 h-9 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                                >
                                    {isPending ? "Dismissing…" : "Confirm Dismiss"}
                                </button>
                                <button
                                    onClick={() => setShowDismissForm(false)}
                                    className="flex-1 h-9 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex gap-2">
                            <button
                                onClick={handleResolve}
                                disabled={isPending}
                                aria-disabled={isPending}
                                className="flex-1 h-9 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                            >
                                {isPending ? "Resolving…" : "Approve & Queue"}
                            </button>
                            <button
                                onClick={() => setShowDismissForm(true)}
                                disabled={isPending}
                                className="flex-1 h-9 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 text-sm font-medium transition-colors duration-150 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                            >
                                Dismiss
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}