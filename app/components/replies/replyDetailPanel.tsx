"use client";

import { useEffect, useRef, useState } from "react";

import type { Reply } from "@/app/api/src/lib/reply/replyTypes";
import { INTENT_CONFIG } from "@/app/api/src/lib/reply/replyConfig";
import {
    formatTimeAgo,
    getAvatarGradient,
    getInitials,
    parseEmailThread,
} from "@/app/api/src/lib/reply/reply.utils";
import { SentimentBar } from "./SentimentBar";
import { ConfidencePill } from "./confidencePill";
import {
    patchReply,
    sendReplyDraft,
} from "@/app/api/replies/replyApi";
import { useToast } from "@/app/hooks/useToast";
import { ToastRegion } from "@/app/components/dashboard/ToastRegion";

/**
 * EnrichedReply augments the base Reply type with intelligence fields
 * returned by the classifier / reply-analysis pipeline.
 */
interface EnrichedReply extends Reply {
    painPoints?: string[] | null;
    competitorsMentioned?: string[] | null;
    buyingStage?: string | null;
}

type ReplyIntent = Reply["intent"];

interface ReplyDetailPanelProps {
    reply: EnrichedReply;
    onClose: () => void;
    onMarkReviewed: (id: string) => void;
    onDraftSent: (id: string) => void;
    onSnoozed?: (id: string) => void;
    onIntentUpdated?: (id: string, intent: ReplyIntent) => void;
}

const BUYING_STAGE_CFG: Record<
    string,
    { label: string; color: string }
> = {
    RESEARCHING: {
        label: "Researching",
        color:
            "text-sky-400 bg-sky-400/10 border-sky-400/20",
    },
    EVALUATING: {
        label: "Evaluating",
        color:
            "text-violet-400 bg-violet-400/10 border-violet-400/20",
    },
    HOT: {
        label: "Hot — Ready",
        color:
            "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
    },
    DISQUALIFIED: {
        label: "Disqualified",
        color:
            "text-[var(--red-text)] bg-[var(--red-glow)] border-[var(--border-red)]",
    },
    UNKNOWN: {
        label: "Unknown",
        color:
            "text-[var(--text-muted)] bg-[var(--surface-2)] border-[var(--border)]",
    },
};

function getErrorMessage(
    error: unknown,
    fallback: string,
): string {
    if (error instanceof Error && error.message.trim()) {
        return error.message;
    }

    if (
        typeof error === "object" &&
        error !== null &&
        "message" in error &&
        typeof error.message === "string" &&
        error.message.trim()
    ) {
        return error.message;
    }

    return fallback;
}

async function getResponseError(
    response: Response,
    fallback: string,
): Promise<string> {
    try {
        const contentType =
            response.headers.get("content-type") ?? "";

        if (contentType.includes("application/json")) {
            const data = await response.json();

            if (
                data &&
                typeof data === "object" &&
                "message" in data &&
                typeof data.message === "string"
            ) {
                return data.message;
            }

            if (
                data &&
                typeof data === "object" &&
                "error" in data &&
                typeof data.error === "string"
            ) {
                return data.error;
            }
        } else {
            const text = await response.text();

            if (text.trim()) {
                return text.trim();
            }
        }
    } catch {
        // Fall back to the supplied message.
    }

    return fallback;
}

function AISignalsCard({
    reply,
}: {
    reply: EnrichedReply;
}) {
    const hasPainPoints =
        (reply.painPoints?.length ?? 0) > 0;

    const hasCompetitors =
        (reply.competitorsMentioned?.length ?? 0) > 0;

    const hasBuyingStage =
        Boolean(reply.buyingStage);

    const hasObjection =
        Boolean(reply.objectionCategory);

    if (
        !hasPainPoints &&
        !hasCompetitors &&
        !hasBuyingStage &&
        !hasObjection
    ) {
        return null;
    }

    const stageCfg = reply.buyingStage
        ? (
            BUYING_STAGE_CFG[reply.buyingStage] ??
            BUYING_STAGE_CFG.UNKNOWN
        )
        : null;

    return (
        <div className="rounded-lg bg-[var(--surface-2)] border border-[var(--border)] p-3 space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                AI Signal Extraction
            </p>

            {hasBuyingStage && stageCfg && (
                <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--text-muted)]">
                        Buying stage
                    </span>

                    <span
                        className={`text - [10px] font - semibold px - 2 py - 0.5 rounded - full border ${stageCfg.color} `}
                    >
                        {stageCfg.label}
                    </span>
                </div>
            )}

            {hasPainPoints && (
                <div className="space-y-1.5">
                    <p className="text-[10px] text-[var(--text-muted)]">
                        Pain points identified
                    </p>

                    <div className="flex flex-wrap gap-1.5">
                        {reply.painPoints!.map((point) => (
                            <span
                                key={point}
                                className="text-[10px] font-medium px-2 py-0.5 rounded-full border text-amber-400 bg-amber-400/10 border-amber-400/20"
                            >
                                {point}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {hasCompetitors && (
                <div className="space-y-1.5">
                    <p className="text-[10px] text-[var(--text-muted)] flex items-center gap-1">
                        <svg
                            width="9"
                            height="9"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            aria-hidden="true"
                        >
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                            <line x1="12" y1="9" x2="12" y2="13" />
                            <line x1="12" y1="17" x2="12.01" y2="17" />
                        </svg>
                        Competitors mentioned
                    </p>

                    <div className="flex flex-wrap gap-1.5">
                        {reply.competitorsMentioned!.map(
                            (competitor) => (
                                <span
                                    key={competitor}
                                    className="text-[10px] font-semibold px-2 py-0.5 rounded-full border text-[var(--red-text)] bg-[var(--red-glow)] border-[var(--border-red)]"
                                >
                                    ⚠ {competitor}
                                </span>
                            ),
                        )}
                    </div>
                </div>
            )}

            {hasObjection && (
                <div className="flex items-center justify-between pt-1 border-t border-[var(--border)]">
                    <span className="text-[10px] text-[var(--text-muted)]">
                        Objection type
                    </span>

                    <span className="text-[10px] font-medium text-[var(--text-secondary)]">
                        {reply.objectionCategory}
                    </span>
                </div>
            )}
        </div>
    );
}

function OutreachThreadDrawer({
    message,
}: {
    message: EnrichedReply["outreachMessage"];
}) {
    const [open, setOpen] = useState(false);

    const label = message.isFollowUp
        ? `Follow - up #${message.followUpStep ?? ""} `
        : "Initial outreach";

    const sentLabel = message.sentAt
        ? new Date(message.sentAt).toLocaleDateString(
            undefined,
            {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
            },
        )
        : null;

    return (
        <div className="rounded-lg bg-[var(--surface-2)] border border-[var(--border)] overflow-hidden">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                aria-expanded={open}
                className="w-full flex items-start justify-between gap-3 p-3 text-left hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] focus-visible:ring-inset"
            >
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                            Original outreach
                        </p>

                        <span
                            className={`text - [9px] font - semibold px - 1.5 py - 0.5 rounded - full border leading - none ${message.isFollowUp
                                    ? "bg-sky-400/10 border-sky-400/20 text-sky-400"
                                    : "bg-[var(--red-glow)] border-[var(--border-red)] text-[var(--red-text)]"
                                } `}
                        >
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

                <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`flex - shrink - 0 mt - 0.5 text - [var(--text - muted)]transition - transform duration - 200 ${open ? "rotate-180" : ""
                        } `}
                    aria-hidden="true"
                >
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </button>

            {open && (
                <div className="border-t border-[var(--border)] px-3 py-3 bg-[var(--navy-mid)]">
                    <p className="text-xs text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap break-words">
                        {message.body || (
                            <span className="text-[var(--text-muted)] italic">
                                No body content
                            </span>
                        )}
                    </p>
                </div>
            )}
        </div>
    );
}

export function ReplyDetailPanel({
    reply,
    onClose,
    onMarkReviewed,
    onDraftSent,
    onSnoozed,
    onIntentUpdated,
}: ReplyDetailPanelProps) {
    const cfg = INTENT_CONFIG[reply.intent];

    const [marking, setMarking] = useState(false);
    const [sending, setSending] = useState(false);
    const [sendError, setSendError] = useState<string | null>(null);

    const [editing, setEditing] = useState(false);
    const [editedDraft, setEditedDraft] = useState(
        reply.draftBody ?? "",
    );
    const [savingDraft, setSavingDraft] = useState(false);

    const [showSnoozeMenu, setShowSnoozeMenu] =
        useState(false);
    const [booking, setBooking] = useState(false);
    const [updatingIntent, setUpdatingIntent] =
        useState<ReplyIntent | null>(null);

    const textareaRef =
        useRef<HTMLTextAreaElement>(null);

    const snoozeRef =
        useRef<HTMLDivElement>(null);

    const {
        toasts,
        addToast,
        dismiss,
    } = useToast();

    const hasDraft = Boolean(reply.draftBody);
    const draftAlreadySent =
        Boolean(reply.draftSentAt);

    const isDirty =
        editedDraft !== (reply.draftBody ?? "");

    useEffect(() => {
        setEditedDraft(reply.draftBody ?? "");
        setEditing(false);
        setSendError(null);
        setShowSnoozeMenu(false);
        setUpdatingIntent(null);
    }, [reply.id, reply.draftBody]);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (
                snoozeRef.current &&
                !snoozeRef.current.contains(
                    event.target as Node,
                )
            ) {
                setShowSnoozeMenu(false);
            }
        }

        document.addEventListener(
            "mousedown",
            handleClickOutside,
        );

        return () => {
            document.removeEventListener(
                "mousedown",
                handleClickOutside,
            );
        };
    }, []);

    useEffect(() => {
        if (!editing || !textareaRef.current) {
            return;
        }

        const element = textareaRef.current;

        element.style.height = "auto";
        element.style.height =
            `${element.scrollHeight} px`;

        element.focus();
    }, [editing]);

    function handleTextareaInput(
        event: React.ChangeEvent<HTMLTextAreaElement>,
    ) {
        setEditedDraft(event.target.value);

        event.target.style.height = "auto";
        event.target.style.height =
            `${event.target.scrollHeight} px`;
    }

    async function handleSnooze(days: number) {
        if (sending || marking || booking) {
            return;
        }

        const date = new Date(
            Date.now() + days * 24 * 60 * 60 * 1000,
        );

        try {
            await patchReply(reply.id, {
                snoozedUntil: date.toISOString(),
            });

            onSnoozed?.(reply.id);

            addToast(
                "success",
                `Reply snoozed for ${days === 1 ? "1 day" : `${days} days`}`,
            );
        } catch (error) {
            console.error(
                "Failed to snooze reply:",
                error,
            );

            addToast(
                "error",
                getErrorMessage(
                    error,
                    "Failed to snooze — please try again",
                ),
            );
        } finally {
            setShowSnoozeMenu(false);
        }
    }

    async function handleMarkMeetingBookedAction() {
        if (booking) {
            return;
        }

        setBooking(true);

        try {
            const response = await fetch(
                `/ api / replies / ${reply.id}/mark-meeting-booked`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        notes:
                            "Marked booked via one-click triage tag",
                    }),
                },
            );

            if (!response.ok) {
                throw new Error(
                    await getResponseError(
                        response,
                        "Failed to mark meeting booked",
                    ),
                );
            }

            onIntentUpdated?.(
                reply.id,
                "MEETING_REQUEST" as ReplyIntent,
            );

            addToast(
                "success",
                "Meeting marked as booked",
            );
        } catch (error) {
            console.error(
                "Error marking meeting booked:",
                error,
            );

            addToast(
                "error",
                getErrorMessage(
                    error,
                    "Failed to mark meeting booked — please try again",
                ),
            );
        } finally {
            setBooking(false);
        }
    }

    async function handleUpdateIntent(
        newIntent: ReplyIntent,
    ) {
        if (
            updatingIntent !== null ||
            booking ||
            marking ||
            sending
        ) {
            return;
        }

        setUpdatingIntent(newIntent);

        try {
            await patchReply(reply.id, {
                intent: newIntent,
            });

            onIntentUpdated?.(
                reply.id,
                newIntent,
            );

            addToast(
                "success",
                "Intent updated",
            );
        } catch (error) {
            console.error(
                "Failed to update intent:",
                error,
            );

            addToast(
                "error",
                getErrorMessage(
                    error,
                    "Failed to update intent — please try again",
                ),
            );
        } finally {
            setUpdatingIntent(null);
        }
    }

    async function handleMarkReviewed() {
        if (marking) {
            return;
        }

        setMarking(true);

        try {
            await patchReply(reply.id, {
                requiresHumanReview: false,
            });

            onMarkReviewed(reply.id);

            addToast(
                "success",
                "Reply marked as reviewed",
            );
        } catch (error) {
            console.error(
                "Failed to mark reply reviewed:",
                error,
            );

            addToast(
                "error",
                getErrorMessage(
                    error,
                    "Failed to mark reviewed — please try again",
                ),
            );
        } finally {
            setMarking(false);
        }
    }

    async function handleSendDraft() {
        if (
            sending ||
            savingDraft ||
            draftAlreadySent
        ) {
            return;
        }

        setSending(true);
        setSendError(null);

        try {
            /*
             * Save edited draft first.
             *
             * If this fails, do NOT attempt to send the
             * previous/stale draft.
             */
            if (isDirty) {
                setSavingDraft(true);

                try {
                    await patchReply(reply.id, {
                        draftBody: editedDraft,
                    });
                } finally {
                    setSavingDraft(false);
                }
            }

            await sendReplyDraft(reply.id);

            /*
             * Sending a reply also satisfies the human-review
             * requirement when one existed.
             */
            if (reply.requiresHumanReview) {
                try {
                    await patchReply(reply.id, {
                        requiresHumanReview: false,
                    });

                    onMarkReviewed(reply.id);
                } catch (reviewError) {
                    /*
                     * The email was already sent. Do not tell
                     * the user that sending failed.
                     *
                     * Instead, surface the secondary state
                     * update failure separately.
                     */
                    console.error(
                        "Reply sent but failed to clear human review:",
                        reviewError,
                    );

                    addToast(
                        "info",
                        "Reply sent, but review status could not be updated",
                    );
                }
            }

            onDraftSent(reply.id);

            addToast(
                "success",
                "Reply sent successfully",
            );

            setEditing(false);
        } catch (error) {
            const message = getErrorMessage(
                error,
                "Failed to send draft",
            );

            console.error(
                "Failed to send draft:",
                error,
            );

            setSendError(message);

            addToast(
                "error",
                message,
            );
        } finally {
            setSending(false);
            setSavingDraft(false);
        }
    }

    return (
        <div className="flex flex-col h-full bg-[var(--surface)] border-l border-[var(--border)] overflow-hidden">
            <ToastRegion
                toasts={toasts}
                onDismiss={dismiss}
            />

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] flex-shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                    <div
                        className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`}
                        aria-hidden="true"
                    />

                    <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
                        {reply.lead.firstName}{" "}
                        {reply.lead.lastName}
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

                <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Snooze */}
                    <div
                        className="relative"
                        ref={snoozeRef}
                    >
                        <button
                            type="button"
                            onClick={() =>
                                setShowSnoozeMenu(
                                    (value) => !value,
                                )
                            }
                            disabled={
                                sending ||
                                marking ||
                                booking
                            }
                            aria-expanded={
                                showSnoozeMenu
                            }
                            className="h-8 px-2.5 flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors duration-150 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            ⏱ <span>Snooze</span>
                        </button>

                        {showSnoozeMenu && (
                            <div className="absolute right-0 top-9 w-44 rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-xl z-50 py-1.5">
                                <p className="px-3 py-1 text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider">
                                    Follow up in...
                                </p>

                                <button
                                    type="button"
                                    onClick={() =>
                                        handleSnooze(1)
                                    }
                                    className="w-full text-left px-3 py-2 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
                                >
                                    ⏱ 1 day (Tomorrow)
                                </button>

                                <button
                                    type="button"
                                    onClick={() =>
                                        handleSnooze(3)
                                    }
                                    className="w-full text-left px-3 py-2 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
                                >
                                    ⏱ 3 days
                                </button>

                                <button
                                    type="button"
                                    onClick={() =>
                                        handleSnooze(7)
                                    }
                                    className="w-full text-left px-3 py-2 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
                                >
                                    ⏱ 1 week
                                </button>
                            </div>
                        )}
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close detail panel"
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] flex-shrink-0 cursor-pointer"
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
                        >
                            <line
                                x1="18"
                                y1="6"
                                x2="6"
                                y2="18"
                            />
                            <line
                                x1="6"
                                y1="6"
                                x2="18"
                                y2="18"
                            />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                {/* Lead */}
                <div className="rounded-lg bg-[var(--surface-2)] border border-[var(--border)] p-4 space-y-2.5">
                    <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                        Lead
                    </p>

                    <div className="flex items-center gap-3">
                        <div
                            className={`w-9 h-9 rounded-full bg-gradient-to-br ${getAvatarGradient(
                                reply.lead.id,
                            )} flex items-center justify-center text-xs font-bold text-white flex-shrink-0`}
                            aria-hidden="true"
                        >
                            {getInitials(
                                reply.lead.firstName ?? "",
                                reply.lead.lastName ?? "",
                            )}
                        </div>

                        <div className="min-w-0">
                            <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                                {reply.lead.firstName}{" "}
                                {reply.lead.lastName}
                            </p>

                            <p className="text-xs text-[var(--text-muted)] truncate">
                                {reply.lead.email}
                            </p>

                            <p className="text-xs text-[var(--text-secondary)] truncate">
                                {reply.lead.companyName}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Sentiment + Confidence */}
                <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg bg-[var(--surface-2)] border border-[var(--border)] p-3 space-y-1.5">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                            Sentiment
                        </p>

                        <SentimentBar
                            score={
                                reply.sentimentScore ??
                                null
                            }
                        />
                    </div>

                    <div className="rounded-lg bg-[var(--surface-2)] border border-[var(--border)] p-3 space-y-1.5">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                            Confidence
                        </p>

                        <div className="pt-0.5">
                            <ConfidencePill
                                confidence={
                                    reply.confidence ??
                                    null
                                }
                            />
                        </div>
                    </div>
                </div>

                {/* Intent & Triage */}
                <div className="rounded-lg bg-[var(--surface-2)] border border-[var(--border)] p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                            Intent & Triage
                        </p>

                        <span
                            className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.badge}`}
                        >
                            {cfg.label}
                        </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 pt-1">
                        <button
                            type="button"
                            onClick={
                                handleMarkMeetingBookedAction
                            }
                            disabled={
                                booking ||
                                sending ||
                                marking ||
                                updatingIntent !== null
                            }
                            className={`flex flex-col items-center justify-center p-2.5 rounded-lg border transition-all text-[11px] font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${reply.intent ===
                                "MEETING_REQUEST" ||
                                reply.lead.pipelineStage ===
                                "MEETING_BOOKED"
                                ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                                : "border-[var(--border)] bg-[var(--surface)] hover:border-emerald-500/40 hover:bg-emerald-500/5 text-[var(--text-secondary)] hover:text-emerald-400"
                                }`}
                        >
                            <span className="text-base mb-1">
                                📅
                            </span>

                            {booking
                                ? "Booking..."
                                : "Book Meeting"}
                        </button>

                        <button
                            type="button"
                            onClick={() =>
                                handleUpdateIntent(
                                    "NOT_INTERESTED" as ReplyIntent,
                                )
                            }
                            disabled={
                                booking ||
                                marking ||
                                sending ||
                                updatingIntent !== null
                            }
                            className={`flex flex-col items-center justify-center p-2.5 rounded-lg border transition-all text-[11px] font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${reply.intent ===
                                "NOT_INTERESTED" ||
                                reply.intent ===
                                "NEGATIVE"
                                ? "border-rose-500 bg-rose-500/10 text-rose-400"
                                : "border-[var(--border)] bg-[var(--surface)] hover:border-rose-500/40 hover:bg-rose-500/5 text-[var(--text-secondary)] hover:text-rose-400"
                                }`}
                        >
                            <span className="text-base mb-1">
                                👎
                            </span>

                            {updatingIntent ===
                                ("NOT_INTERESTED" as ReplyIntent)
                                ? "Updating..."
                                : "Not Interested"}
                        </button>

                        <button
                            type="button"
                            onClick={() =>
                                handleUpdateIntent(
                                    "QUESTION" as ReplyIntent,
                                )
                            }
                            disabled={
                                booking ||
                                marking ||
                                sending ||
                                updatingIntent !== null
                            }
                            className={`flex flex-col items-center justify-center p-2.5 rounded-lg border transition-all text-[11px] font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${reply.intent ===
                                "QUESTION"
                                ? "border-sky-500 bg-sky-500/10 text-sky-400"
                                : "border-[var(--border)] bg-[var(--surface)] hover:border-sky-500/40 hover:bg-sky-500/5 text-[var(--text-secondary)] hover:text-sky-400"
                                }`}
                        >
                            <span className="text-base mb-1">
                                💬
                            </span>

                            {updatingIntent ===
                                ("QUESTION" as ReplyIntent)
                                ? "Updating..."
                                : "Need Info"}
                        </button>
                    </div>
                </div>

                {/* AI Signals */}
                <AISignalsCard reply={reply} />

                {/* Conversation */}
                <div className="space-y-2">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                        Conversation Thread
                    </p>

                    <div className="relative pl-4 border-l-2 border-[var(--border)] ml-3 space-y-4 pt-1">
                        {/* Outbound */}
                        <div className="relative bg-[var(--surface-2)] border border-[var(--border)] rounded-lg p-4 space-y-2">
                            <div className="absolute -left-[23px] top-5 w-2 h-2 rounded-full bg-blue-500 border border-[var(--surface)]" />

                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className="text-[9px] font-bold uppercase tracking-wider text-blue-400 bg-blue-400/10 border border-blue-400/20 px-2 py-0.5 rounded-full">
                                        Sent Outreach
                                    </span>

                                    {reply.outreachMessage
                                        .isFollowUp && (
                                            <span className="text-[9px] font-semibold bg-sky-400/10 border border-sky-400/20 text-sky-400 px-1.5 py-0.5 rounded-full">
                                                Follow-up #
                                                {
                                                    reply
                                                        .outreachMessage
                                                        .followUpStep
                                                }
                                            </span>
                                        )}
                                </div>

                                {reply.outreachMessage
                                    .sentAt && (
                                        <span className="text-[10px] text-[var(--text-muted)]">
                                            {new Date(
                                                reply
                                                    .outreachMessage
                                                    .sentAt,
                                            ).toLocaleString(
                                                undefined,
                                                {
                                                    month: "short",
                                                    day: "numeric",
                                                    hour: "2-digit",
                                                    minute: "2-digit",
                                                },
                                            )}
                                        </span>
                                    )}
                            </div>

                            <p className="text-xs font-semibold text-[var(--text-primary)]">
                                Subject:{" "}
                                {reply.outreachMessage
                                    .subject ||
                                    "(no subject)"}
                            </p>

                            <p className="text-xs text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap break-words mt-1 border-t border-[var(--border)] pt-2 font-sans">
                                {reply.outreachMessage
                                    .body || (
                                        <span className="text-[var(--text-muted)] italic">
                                            No body content
                                        </span>
                                    )}
                            </p>
                        </div>

                        {/* Inbound */}
                        {(() => {
                            const {
                                replyText,
                                quotedChain,
                            } = parseEmailThread(
                                reply.body,
                            );

                            return (
                                <div className="relative bg-[var(--navy-mid)] border border-[var(--border)] rounded-lg p-4 space-y-3">
                                    <div className="absolute -left-[23px] top-5 w-2 h-2 rounded-full bg-amber-400 border border-[var(--surface)]" />

                                    <div className="flex items-center justify-between">
                                        <span className="text-[9px] font-bold uppercase tracking-wider text-amber-400 bg-amber-400/10 border border-amber-400/20 px-2 py-0.5 rounded-full">
                                            Inbound Reply
                                        </span>

                                        <span className="text-[10px] text-[var(--text-muted)]">
                                            {new Date(
                                                reply.createdAt,
                                            ).toLocaleString(
                                                undefined,
                                                {
                                                    month: "short",
                                                    day: "numeric",
                                                    hour: "2-digit",
                                                    minute: "2-digit",
                                                },
                                            )}
                                        </span>
                                    </div>

                                    <p className="text-sm font-medium text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap break-words font-sans">
                                        {replyText ||
                                            reply.body}
                                    </p>

                                    {quotedChain && (
                                        <details className="mt-2 pt-2 border-t border-[var(--border)] group">
                                            <summary className="text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer select-none flex items-center gap-1.5 focus:outline-none">
                                                <svg
                                                    width="10"
                                                    height="10"
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    strokeWidth="2"
                                                    className="transition-transform group-open:rotate-90"
                                                >
                                                    <polyline points="9 18 15 12 9 6" />
                                                </svg>

                                                <span>
                                                    Quoted Email Chain
                                                </span>
                                            </summary>

                                            <div className="mt-2 p-3 bg-black/20 rounded-md border border-[var(--border)] font-mono text-[11px] text-[var(--text-muted)] leading-relaxed whitespace-pre-wrap break-words max-h-60 overflow-y-auto">
                                                {quotedChain}
                                            </div>
                                        </details>
                                    )}
                                </div>
                            );
                        })()}
                    </div>
                </div>

                {/* Draft */}
                {hasDraft && (
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                                Draft reply
                            </p>

                            <div className="flex items-center gap-2">
                                {draftAlreadySent ? (
                                    <span className="text-[10px] text-emerald-400 font-medium">
                                        Sent{" "}
                                        {reply.draftSentAt
                                            ? formatTimeAgo(
                                                reply.draftSentAt,
                                            )
                                            : ""}
                                    </span>
                                ) : !editing ? (
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setEditing(true)
                                        }
                                        disabled={sending}
                                        className="text-[10px] font-medium text-[var(--text-muted)] hover:text-sky-400 inline-flex items-center gap-1 transition-colors focus-visible:outline-none disabled:opacity-50"
                                    >
                                        Edit
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setEditing(false);
                                            setEditedDraft(
                                                reply.draftBody ??
                                                "",
                                            );
                                            setSendError(
                                                null,
                                            );
                                        }}
                                        disabled={sending}
                                        className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none disabled:opacity-50"
                                    >
                                        Cancel
                                    </button>
                                )}
                            </div>
                        </div>

                        {reply.draftSubject && (
                            <p className="text-xs font-medium text-[var(--text-secondary)] truncate">
                                Re: {reply.draftSubject}
                            </p>
                        )}

                        {editing ? (
                            <div className="space-y-1.5">
                                <textarea
                                    ref={textareaRef}
                                    value={editedDraft}
                                    onChange={
                                        handleTextareaInput
                                    }
                                    disabled={sending}
                                    className="w-full min-h-[100px] bg-[var(--navy-mid)] border border-[var(--border-red)] rounded-lg px-4 py-3 text-sm text-[var(--text-primary)] leading-relaxed resize-none focus:outline-none focus:ring-1 focus:ring-[var(--red)]/40 transition-colors duration-150 font-sans disabled:opacity-60"
                                    aria-label="Edit draft reply"
                                />

                                {isDirty && (
                                    <p className="text-[10px] text-amber-400 flex items-center gap-1">
                                        {savingDraft
                                            ? "Saving edits…"
                                            : "Unsaved edits — send to apply"}
                                    </p>
                                )}
                            </div>
                        ) : (
                            <div
                                className={`rounded-lg border p-4 ${draftAlreadySent
                                    ? "border-emerald-500/20 bg-emerald-500/5"
                                    : "border-[var(--border)] bg-[var(--navy-mid)]"
                                    }`}
                            >
                                <p className="text-sm text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap break-words">
                                    {editedDraft ||
                                        reply.draftBody}
                                </p>
                            </div>
                        )}

                        {sendError && (
                            <p
                                className="text-xs text-red-400"
                                role="alert"
                            >
                                {sendError}
                            </p>
                        )}
                    </div>
                )}

                <p className="text-xs text-[var(--text-muted)]">
                    Received{" "}
                    {formatTimeAgo(reply.createdAt)} ·{" "}
                    {new Date(
                        reply.createdAt,
                    ).toLocaleString()}
                </p>
            </div>

            {/* Footer */}
            <div className="flex items-center gap-2 px-5 py-4 border-t border-[var(--border)] flex-shrink-0">
                {hasDraft && !draftAlreadySent && (
                    <button
                        type="button"
                        onClick={handleSendDraft}
                        disabled={
                            sending ||
                            marking ||
                            booking ||
                            updatingIntent !== null
                        }
                        className="flex-1 flex items-center justify-center gap-2 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm font-medium hover:bg-blue-500/20 transition-colors duration-150 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                    >
                        {sending ? (
                            <svg
                                className="animate-spin w-3.5 h-3.5"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                            >
                                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                            </svg>
                        ) : (
                            <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <line
                                    x1="22"
                                    y1="2"
                                    x2="11"
                                    y2="13"
                                />
                                <polygon points="22 2 15 22 11 13 2 9 22 2" />
                            </svg>
                        )}

                        {reply.requiresHumanReview
                            ? editing && isDirty
                                ? "Save & Send"
                                : "Approve & Send"
                            : editing && isDirty
                                ? "Save & Send"
                                : "Send Draft"}
                    </button>
                )}

                {reply.requiresHumanReview &&
                    !hasDraft && (
                        <button
                            type="button"
                            onClick={
                                handleMarkReviewed
                            }
                            disabled={
                                marking ||
                                sending ||
                                booking
                            }
                            className="flex-1 flex items-center justify-center gap-2 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm font-medium hover:bg-emerald-500/20 transition-colors duration-150 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                        >
                            {marking ? (
                                <svg
                                    className="animate-spin w-3.5 h-3.5"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.5"
                                >
                                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                                </svg>
                            ) : (
                                <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <polyline points="20 6 9 17 4 12" />
                                </svg>
                            )}

                            Mark Reviewed
                        </button>
                    )}

                <a
                    href={`/dashboard/leads?highlight=${reply.lead.id}`}
                    className="flex-1 flex items-center justify-center gap-2 h-9 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-secondary)] text-sm font-medium hover:text-[var(--text-primary)] hover:border-[var(--border-red)] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                >
                    <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle
                            cx="9"
                            cy="7"
                            r="4"
                        />
                    </svg>

                    View Lead
                </a>
            </div>
        </div>
    );
}