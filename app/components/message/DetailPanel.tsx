import { useState } from "react";
import type { OutreachMessage } from "@/app/api/src/lib/message/messageHelper";

import { DeliveryTimeline } from "./DeliveryTimeline";
import { leadInitials, leadName } from "@/app/api/src/lib/message";
import { ApprovalBadge } from "./approval";
import { ScoreGauge } from "./ScoreGuage";
import { DiffView } from "./Diffview";

interface DetailPanelProps {
    message: OutreachMessage;
    onApprove: (id: string, editedSubject?: string, editedBody?: string) => void;
    onReject: (id: string) => void;
}

export function DetailPanel({ message, onApprove, onReject }: DetailPanelProps) {
    const [rejectNote, setRejectNote] = useState("");
    const [showRejectInput, setShowRejectInput] = useState(false);
    const [loading, setLoading] = useState<"approve" | "reject" | "save" | null>(null);
    const [editing, setEditing] = useState(false);
    const [editedSubject, setEditedSubject] = useState(message.subject);
    const [editedBody, setEditedBody] = useState(message.body);

    const isDirty = editedSubject !== message.subject || editedBody !== message.body;

    const handleApprove = async () => {
        setLoading("approve");
        try {
            if (isDirty) {
                const token = typeof window !== "undefined" ? localStorage.getItem("ss_token") : "";
                const res = await fetch(`/api/outreach-messages/${message.id}`, {
                    method: "PATCH",
                    headers: {
                        Authorization: `Bearer ${token ?? ""}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        ...(editedSubject !== message.subject && { subject: editedSubject }),
                        ...(editedBody !== message.body && { body: editedBody }),
                    }),
                });
                if (!res.ok) throw new Error("Save failed");
            }
            await new Promise((r) => setTimeout(r, 400));
            onApprove(message.id, editedSubject !== message.subject ? editedSubject : undefined, editedBody !== message.body ? editedBody : undefined);
            setEditing(false);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(null);
        }
    };

    const handleReject = async () => {
        if (!showRejectInput) {
            setShowRejectInput(true);
            return;
        }
        setLoading("reject");
        await new Promise((r) => setTimeout(r, 600));
        onReject(message.id);
        setLoading(null);
        setShowRejectInput(false);
        setRejectNote("");
    };

    const hasDiff = message.diffVector && Object.keys(message.diffVector).length > 0;
    const isPending = message.approvalStatus === "PENDING";

    return (
        <div className="flex flex-col h-full">
            <div className="flex-shrink-0 px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-700 dark:to-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-600 dark:text-slate-300 flex-shrink-0">
                                {leadInitials(message.lead)}
                            </div>
                            <div>
                                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                    {leadName(message.lead)}
                                </span>
                                {message.lead.email && (
                                    <span className="text-xs text-slate-400 ml-2">
                                        {message.lead.email}
                                    </span>
                                )}
                            </div>
                        </div>
                        <p className="text-xs text-slate-400 pl-9">{message.lead.companyName}</p>
                    </div>
                    <ApprovalBadge status={message.approvalStatus} />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 grid grid-cols-2 gap-4">
                    <ScoreGauge value={message.spamRiskScore} label="Spam Risk" variant="spam" />
                    <ScoreGauge value={message.personalizationScore} label="Personalization" variant="personal" />
                </div>

                <div className="px-6 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <span className="text-[11px] text-slate-400 uppercase tracking-wider font-medium">
                        Delivery
                    </span>
                    <DeliveryTimeline state={message.deliveryState} />
                </div>

                <div className="px-6 py-5 space-y-5">
                    <div>
                        <p className="text-[10px] text-slate-400 uppercase tracking-wider font-medium mb-1.5">
                            Subject
                        </p>
                        {editing ? (
                            <input
                                type="text"
                                value={editedSubject}
                                onChange={(e) => setEditedSubject(e.target.value)}
                                className="w-full rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                            />
                        ) : (
                            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                                {message.subject}
                            </p>
                        )}
                    </div>

                    {hasDiff && message.diffVector?.subject && (
                        <DiffView
                            original={message.diffVector.subject.from}
                            updated={message.diffVector.subject.to}
                            label="subject"
                        />
                    )}

                    <div>
                        <p className="text-[10px] text-slate-400 uppercase tracking-wider font-medium mb-1.5">
                            Body
                        </p>
                        {editing ? (
                            <textarea
                                value={editedBody}
                                onChange={(e) => setEditedBody(e.target.value)}
                                rows={8}
                                className="w-full rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 leading-relaxed focus:outline-none focus:ring-2 focus:ring-violet-500/40 resize-y"
                            />
                        ) : (
                            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/40 dark:bg-slate-800/40 p-4">
                                <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                                    {message.body}
                                </p>
                            </div>
                        )}
                    </div>

                    {hasDiff && message.diffVector?.body && (
                        <DiffView
                            original={message.diffVector.body.from}
                            updated={message.diffVector.body.to}
                            label="body"
                        />
                    )}

                    {message.approvedBy && (
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                            <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                                <circle cx="12" cy="7" r="4" />
                            </svg>
                            <span>
                                {message.approvalStatus === "APPROVED" ? "Approved" : "Rejected"} by{" "}
                                <span className="text-slate-600 dark:text-slate-300 font-medium">
                                    {message.approvedBy.firstName} {message.approvedBy.lastName}
                                </span>
                            </span>
                        </div>
                    )}

                    {showRejectInput && isPending && (
                        <div className="space-y-2">
                            <label
                                htmlFor="reject-note"
                                className="text-[11px] text-slate-400 uppercase tracking-wider font-medium block"
                            >
                                Rejection note (optional)
                            </label>
                            <textarea
                                id="reject-note"
                                value={rejectNote}
                                onChange={(e) => setRejectNote(e.target.value)}
                                placeholder="e.g. Too generic, missing company context…"
                                rows={3}
                                className="w-full rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-red-500/40 focus:border-red-500/40 transition-colors"
                            />
                        </div>
                    )}
                </div>
            </div>

            {isPending && (
                <div className="flex-shrink-0 px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                    {isDirty && (
                        <p className="text-[10px] text-amber-500 text-center mb-3">
                            Unsaved edits — approving will save changes
                        </p>
                    )}
                    <div className="flex items-center gap-3">
                        {!editing ? (
                            <button
                                onClick={() => setEditing(true)}
                                className="flex-1 flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all duration-150 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                            >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                Edit
                            </button>
                        ) : (
                            <button
                                onClick={() => { setEditing(false); setEditedSubject(message.subject); setEditedBody(message.body); }}
                                className="flex-1 flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all duration-150 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                            >
                                Cancel
                            </button>
                        )}

                        <button
                            onClick={handleReject}
                            disabled={loading !== null}
                            className={[
                                "flex-1 flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all duration-150",
                                "border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400",
                                "hover:border-red-300 dark:hover:border-red-700 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500",
                                "disabled:opacity-40 disabled:cursor-not-allowed",
                                showRejectInput
                                    ? "border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/10"
                                    : "",
                            ].join(" ")}
                        >
                            {loading === "reject" ? (
                                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
                                </svg>
                            ) : (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            )}
                            {showRejectInput ? "Confirm Reject" : "Reject"}
                        </button>

                        <button
                            onClick={handleApprove}
                            disabled={loading !== null}
                            className={[
                                "flex-1 flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all duration-150",
                                "bg-emerald-500 hover:bg-emerald-400 text-white",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2",
                                "disabled:opacity-40 disabled:cursor-not-allowed",
                                "shadow-sm shadow-emerald-500/20",
                            ].join(" ")}
                        >
                            {loading === "approve" ? (
                                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
                                </svg>
                            ) : (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12" />
                                </svg>
                            )}
                            Approve
                        </button>
                    </div>
                    <p className="text-[10px] text-slate-400 text-center mt-2">
                        Approving will queue the message for sending
                    </p>
                </div>
            )}
        </div>
    );
}