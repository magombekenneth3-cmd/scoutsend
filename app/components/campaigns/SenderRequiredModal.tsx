"use client";

import React, { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export interface SenderRequiredModalProps {
    open: boolean;
    campaignId?: string;
    campaignName?: string;
    errorMessage?: string | null;
    onClose: () => void;
}

export function SenderRequiredModal({
    open,
    campaignId,
    campaignName = "Campaign",
    errorMessage,
    onClose,
}: SenderRequiredModalProps) {
    const router = useRouter();
    const dialogRef = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        if (open) {
            dialogRef.current?.showModal();
        } else {
            dialogRef.current?.close();
        }
    }, [open]);

    if (!open) return null;

    const isNoLeads = errorMessage?.toLowerCase().includes("no leads");

    return (
        <dialog
            ref={dialogRef}
            onClose={onClose}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 w-full h-full max-w-full max-h-full outline-none backdrop:bg-black/65"
            aria-labelledby="sender-modal-title"
        >
            <div className="relative w-full max-w-lg bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 sm:p-7 shadow-[var(--shadow-lg)] space-y-6 animate-fade-up">
                {/* Close button */}
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none"
                    aria-label="Close modal"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                </button>

                {/* Header */}
                <div className="flex items-start gap-4 pr-6">
                    <div className="w-12 h-12 rounded-xl bg-[var(--red-glow)] border border-[var(--border-red)] flex items-center justify-center text-[var(--red)] flex-shrink-0">
                        {isNoLeads ? (
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                <circle cx="9" cy="7" r="4" />
                                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                            </svg>
                        ) : (
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                                <polyline points="22,6 12,13 2,6" />
                            </svg>
                        )}
                    </div>
                    <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--red)] font-display">
                            {isNoLeads ? "Leads Required" : "Sender Required"}
                        </span>
                        <h2 id="sender-modal-title" className="text-lg font-bold text-[var(--text-primary)] font-display leading-tight">
                            {isNoLeads ? "Add Leads to Campaign" : "No Sender Configured"}
                        </h2>
                        <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                            {isNoLeads
                                ? `Campaign "${campaignName}" needs at least one lead before launching.`
                                : `Campaign "${campaignName}" has no sender configured. Set a sender domain, mailbox, or LinkedIn account before running.`}
                        </p>
                    </div>
                </div>

                {/* Guided Next Step Options */}
                <div className="space-y-2.5">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] font-display">
                        Choose what to do next:
                    </p>

                    {isNoLeads ? (
                        <>
                            <button
                                onClick={() => {
                                    onClose();
                                    if (campaignId) router.push(`/dashboard/campaigns/${campaignId}?tab=discovery`);
                                    else router.push(`/dashboard/find-leads`);
                                }}
                                className="w-full text-left p-3.5 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--border-red)] transition-all duration-150 flex items-center justify-between group"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <circle cx="11" cy="11" r="8" />
                                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                                        </svg>
                                    </div>
                                    <div>
                                        <h3 className="text-xs font-semibold text-[var(--text-primary)] group-hover:text-[var(--red)] transition-colors">
                                            Discover AI Prospect Leads
                                        </h3>
                                        <p className="text-[11px] text-[var(--text-muted)]">Run automated ICP lead discovery for this campaign.</p>
                                    </div>
                                </div>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[var(--text-muted)] group-hover:text-[var(--red)] transition-colors">
                                    <polyline points="9 18 15 12 9 6" />
                                </svg>
                            </button>
                        </>
                    ) : (
                        <>
                            {/* Option 1: Domains */}
                            <button
                                onClick={() => {
                                    onClose();
                                    router.push("/dashboard/domains");
                                }}
                                className="w-full text-left p-3.5 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--border-red)] transition-all duration-150 flex items-center justify-between group"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <rect x="2" y="3" width="20" height="14" rx="2" />
                                            <line x1="2" y1="10" x2="22" y2="10" />
                                        </svg>
                                    </div>
                                    <div>
                                        <h3 className="text-xs font-semibold text-[var(--text-primary)] group-hover:text-[var(--red)] transition-colors">
                                            Connect Sender Domain
                                        </h3>
                                        <p className="text-[11px] text-[var(--text-muted)] font-sans">Authorize custom domain with SPF, DKIM & DMARC.</p>
                                    </div>
                                </div>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[var(--text-muted)] group-hover:text-[var(--red)] transition-colors">
                                    <polyline points="9 18 15 12 9 6" />
                                </svg>
                            </button>

                            {/* Option 2: Mailboxes */}
                            <button
                                onClick={() => {
                                    onClose();
                                    router.push("/dashboard/mailboxes");
                                }}
                                className="w-full text-left p-3.5 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--border-red)] transition-all duration-150 flex items-center justify-between group"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                                            <polyline points="22,6 12,13 2,6" />
                                        </svg>
                                    </div>
                                    <div>
                                        <h3 className="text-xs font-semibold text-[var(--text-primary)] group-hover:text-[var(--red)] transition-colors">
                                            Configure Mailbox
                                        </h3>
                                        <p className="text-[11px] text-[var(--text-muted)] font-sans">Connect Google, Outlook, or SMTP sending mailbox.</p>
                                    </div>
                                </div>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[var(--text-muted)] group-hover:text-[var(--red)] transition-colors">
                                    <polyline points="9 18 15 12 9 6" />
                                </svg>
                            </button>

                            {/* Option 3: LinkedIn */}
                            <button
                                onClick={() => {
                                    onClose();
                                    router.push("/dashboard/linkedin-accounts");
                                }}
                                className="w-full text-left p-3.5 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--border-red)] transition-all duration-150 flex items-center justify-between group"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
                                            <rect x="2" y="9" width="4" height="12" />
                                            <circle cx="4" cy="4" r="2" />
                                        </svg>
                                    </div>
                                    <div>
                                        <h3 className="text-xs font-semibold text-[var(--text-primary)] group-hover:text-[var(--red)] transition-colors">
                                            Connect LinkedIn Account
                                        </h3>
                                        <p className="text-[11px] text-[var(--text-muted)] font-sans">Link social profile for social selling & InMail.</p>
                                    </div>
                                </div>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[var(--text-muted)] group-hover:text-[var(--red)] transition-colors">
                                    <polyline points="9 18 15 12 9 6" />
                                </svg>
                            </button>

                            {/* Option 4: Edit Campaign Settings */}
                            {campaignId && (
                                <button
                                    onClick={() => {
                                        onClose();
                                        router.push(`/dashboard/campaigns/${campaignId}/edit`);
                                    }}
                                    className="w-full text-left p-3.5 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--border-red)] transition-all duration-150 flex items-center justify-between group"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                            </svg>
                                        </div>
                                        <div>
                                            <h3 className="text-xs font-semibold text-[var(--text-primary)] group-hover:text-[var(--red)] transition-colors">
                                                Edit Campaign Settings
                                            </h3>
                                            <p className="text-[11px] text-[var(--text-muted)] font-sans">Select an existing configured sender for this campaign.</p>
                                        </div>
                                    </div>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[var(--text-muted)] group-hover:text-[var(--red)] transition-colors">
                                        <polyline points="9 18 15 12 9 6" />
                                    </svg>
                                </button>
                            )}
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="pt-2 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg text-xs font-medium text-[var(--text-secondary)] bg-[var(--surface-2)] hover:bg-[var(--surface)] border border-[var(--border)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        Dismiss
                    </button>
                </div>
            </div>
        </dialog>
    );
}
