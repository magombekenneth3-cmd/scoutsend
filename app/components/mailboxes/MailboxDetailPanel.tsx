"use client";

import { useState, useEffect } from "react";
import { SenderMailbox, SenderMailboxDetail } from "@/app/api/mailbox/Mailbox.Types";

/* Warmup fields are optional additions to SenderMailbox that the API may return */
interface WarmupMailbox extends SenderMailbox {
    warmupDay?: number | null;
    warmupTotalDays?: number | null;
    warmupAction?: "ACCELERATE" | "STEADY" | "COOL_DOWN" | null;
    warmupDailyLimit?: number | null;
}
import { fetchMailboxById, updateMailbox, deleteMailbox, verifyMailbox, resetMailboxDailyCount } from "@/app/api/mailbox/mailboxapi";
import { HEALTH_CONFIG } from "@/app/api/src/lib/domains/domainConfig";

interface MailboxDetailPanelProps {
    mailbox: SenderMailbox;
    onClose: () => void;
    onUpdated: (mailbox: SenderMailbox) => void;
    onDeleted: (id: string) => void;
}

function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60_000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-2">
            {children}
        </p>
    );
}

function StatRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
    return (
        <div className="flex items-center justify-between py-1.5 border-b border-[var(--border)] last:border-0">
            <span className="text-xs text-[var(--text-muted)]">{label}</span>
            <span className={`text-xs font-semibold tabular-nums ${valueClass ?? "text-[var(--text-primary)]"}`}>
                {value}
            </span>
        </div>
    );
}

const PROVIDER_LABEL: Record<string, string> = {
    GMAIL: "Gmail",
    OUTLOOK: "Outlook",
    SMTP: "SMTP",
};

const WARMUP_ACTION_CFG: Record<string, { label: string; color: string }> = {
    ACCELERATE: { label: "Accelerating",    color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" },
    STEADY:     { label: "Steady pace",     color: "text-sky-400 bg-sky-400/10 border-sky-400/20" },
    COOL_DOWN:  { label: "Cooling down",    color: "text-amber-400 bg-amber-400/10 border-amber-400/20" },
};

function WarmupProgress({ mailbox }: { mailbox: WarmupMailbox }) {
    if (!mailbox.warmupEnabled) return null;
    const day   = mailbox.warmupDay ?? 0;
    const total = mailbox.warmupTotalDays ?? 28;
    const pct   = total > 0 ? Math.min(Math.round((day / total) * 100), 100) : 0;
    const actionCfg = mailbox.warmupAction ? (WARMUP_ACTION_CFG[mailbox.warmupAction] ?? null) : null;

    return (
        <div className="mt-2 space-y-2 pt-2 border-t border-[var(--border)]">
            <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)]">
                    Day <span className="font-semibold text-[var(--text-secondary)]">{day}</span> of {total}
                </span>
                {actionCfg && (
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${actionCfg.color}`}>
                        {actionCfg.label}
                    </span>
                )}
            </div>
            <div className="h-1.5 w-full rounded-full bg-[var(--surface)] overflow-hidden">
                <div
                    className="h-full rounded-full bg-emerald-400 transition-[width] duration-500 ease-out"
                    style={{ width: `${pct}%` }}
                    role="progressbar"
                    aria-valuenow={day}
                    aria-valuemax={total}
                    aria-label="Warmup progress"
                />
            </div>
            {mailbox.warmupDailyLimit != null && (
                <p className="text-[10px] text-[var(--text-muted)]">
                    Effective limit today:
                    <span className="font-semibold text-[var(--text-secondary)] ml-1">
                        {mailbox.warmupDailyLimit} emails
                    </span>
                </p>
            )}
        </div>
    );
}

export function MailboxDetailPanel({ mailbox, onClose, onUpdated, onDeleted }: MailboxDetailPanelProps) {
    const [detail, setDetail] = useState<SenderMailboxDetail | null>(null);
    const [loadingDetail, setLoadingDetail] = useState(true);
    const [editLimit, setEditLimit] = useState(String(mailbox.dailyLimit));
    const [editLabel, setEditLabel] = useState(mailbox.label);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [verifying, setVerifying] = useState(false);
    const [resetting, setResetting] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [verifyResult, setVerifyResult] = useState<{ connected: boolean } | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);

    useEffect(() => {
        setDetail(null);
        setLoadingDetail(true);
        setEditLimit(String(mailbox.dailyLimit));
        setEditLabel(mailbox.label);
        setSaveError(null);
        setConfirmDelete(false);
        setVerifyResult(null);

        fetchMailboxById(mailbox.id)
            .then(setDetail)
            .catch(() => setDetail(null))
            .finally(() => setLoadingDetail(false));
    }, [mailbox.id, mailbox.dailyLimit, mailbox.label]);

    async function handleSave() {
        const limit = Number(editLimit);
        if (isNaN(limit) || limit < 1 || limit > 10000) {
            setSaveError("Daily limit must be between 1 and 10,000");
            return;
        }
        if (!editLabel.trim()) {
            setSaveError("Label is required");
            return;
        }
        setSaving(true);
        setSaveError(null);
        try {
            const updated = await updateMailbox(mailbox.id, {
                label: editLabel.trim(),
                dailyLimit: limit,
            });
            onUpdated(updated as unknown as SenderMailbox);
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : "Save failed");
        } finally {
            setSaving(false);
        }
    }

    async function handleToggleWarmup() {
        setSaving(true);
        setSaveError(null);
        try {
            const updated = await updateMailbox(mailbox.id, { warmupEnabled: !mailbox.warmupEnabled });
            onUpdated(updated as unknown as SenderMailbox);
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : "Update failed");
        } finally {
            setSaving(false);
        }
    }

    async function handleVerify() {
        setVerifying(true);
        setVerifyResult(null);
        try {
            const result = await verifyMailbox(mailbox.id);
            setVerifyResult(result);
        } catch {
            setVerifyResult({ connected: false });
        } finally {
            setVerifying(false);
        }
    }

    async function handleResetCount() {
        setResetting(true);
        try {
            const updated = await resetMailboxDailyCount(mailbox.id);
            onUpdated(updated as unknown as SenderMailbox);
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : "Reset failed");
        } finally {
            setResetting(false);
        }
    }

    async function handleDelete() {
        setDeleting(true);
        try {
            await deleteMailbox(mailbox.id);
            onDeleted(mailbox.id);
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : "Delete failed");
            setDeleting(false);
            setConfirmDelete(false);
        }
    }

    const cfg = HEALTH_CONFIG[mailbox.health];
    const sentPct = mailbox.dailyLimit > 0
        ? Math.min(Math.round((mailbox.currentSent / mailbox.dailyLimit) * 100), 100)
        : 0;
    const repColor =
        mailbox.reputationScore >= 80 ? "text-emerald-400" :
        mailbox.reputationScore >= 50 ? "text-amber-400" : "text-red-400";
    const bounceWarning = mailbox.bounceRate > 0.05;
    const complaintWarning = mailbox.complaintRate > 0.001;

    const inputCls = "w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-red)] focus:ring-1 focus:ring-[var(--red)]/20 transition-colors duration-150";

    return (
        <div className="flex flex-col h-full bg-[var(--surface)] overflow-hidden">
            {/* Panel header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] flex-shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} aria-hidden="true" />
                    <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
                        {mailbox.label}
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={handleVerify}
                        disabled={verifying}
                        title="Test connection"
                        aria-label="Test mailbox connection"
                        className="flex items-center justify-center w-7 h-7 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] disabled:opacity-40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        {verifying ? (
                            <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                            </svg>
                        ) : (
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                                <polyline points="22 4 12 14.01 9 11.01" />
                            </svg>
                        )}
                    </button>
                    <button
                        onClick={onClose}
                        aria-label="Close panel"
                        className="flex items-center justify-center w-7 h-7 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

                {/* Verify result banner */}
                {verifyResult !== null && (
                    <div className={[
                        "flex items-center gap-2 p-3 rounded-lg border text-xs font-medium",
                        verifyResult.connected
                            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                            : "bg-[var(--red-glow)] border-[var(--border-red)] text-[var(--red)]",
                    ].join(" ")}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            {verifyResult.connected
                                ? <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>
                                : <><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></>
                            }
                        </svg>
                        {verifyResult.connected ? "Connection verified successfully" : "Connection failed — check your credentials"}
                    </div>
                )}

                {/* Identity */}
                <div>
                    <SectionLabel>Identity</SectionLabel>
                    <div className="space-y-1">
                        <StatRow label="Email" value={mailbox.emailAddress} />
                        <StatRow label="Provider" value={PROVIDER_LABEL[mailbox.providerType] ?? mailbox.providerType} />
                        <StatRow label="Added" value={timeAgo(mailbox.createdAt)} />
                        {mailbox.lastReplyCheckedAt && (
                            <StatRow label="Last reply check" value={timeAgo(mailbox.lastReplyCheckedAt)} />
                        )}
                    </div>
                </div>

                {/* Daily send progress */}
                <div>
                    <SectionLabel>Today's sending</SectionLabel>
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-[var(--text-muted)]">Sent today</span>
                            <span className="text-xs font-semibold tabular-nums text-[var(--text-secondary)]">
                                {mailbox.currentSent.toLocaleString()} / {mailbox.dailyLimit.toLocaleString()}
                            </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-[var(--surface-2)] overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all duration-500 ${sentPct >= 90 ? "bg-red-400" : sentPct >= 70 ? "bg-amber-400" : cfg.bar}`}
                                style={{ width: `${sentPct}%` }}
                                role="progressbar"
                                aria-valuenow={sentPct}
                                aria-valuemin={0}
                                aria-valuemax={100}
                            />
                        </div>
                        <button
                            onClick={handleResetCount}
                            disabled={resetting || mailbox.currentSent === 0}
                            className="mt-1 text-xs text-[var(--text-muted)] hover:text-[var(--red)] disabled:opacity-40 transition-colors focus-visible:outline-none focus-visible:underline"
                        >
                            {resetting ? "Resetting…" : "Reset today's count"}
                        </button>
                    </div>
                </div>

                {/* Reputation stats */}
                <div>
                    <SectionLabel>Reputation</SectionLabel>
                    <div className="space-y-0">
                        <StatRow label="Score" value={`${Math.round(mailbox.reputationScore)} / 100`} valueClass={repColor} />
                        <StatRow label="Total sent" value={mailbox.totalSent.toLocaleString()} />
                        <StatRow
                            label="Bounce rate"
                            value={`${(mailbox.bounceRate * 100).toFixed(2)}%`}
                            valueClass={bounceWarning ? "text-red-400" : undefined}
                        />
                        <StatRow
                            label="Complaint rate"
                            value={`${(mailbox.complaintRate * 100).toFixed(3)}%`}
                            valueClass={complaintWarning ? "text-red-400" : undefined}
                        />
                    </div>
                </div>

                {/* Campaigns */}
                {loadingDetail ? (
                    <div>
                        <SectionLabel>Campaigns</SectionLabel>
                        <div className="space-y-2">
                            {Array.from({ length: 2 }).map((_, i) => (
                                <div key={i} className="h-10 rounded-lg bg-[var(--surface-2)] animate-pulse" />
                            ))}
                        </div>
                    </div>
                ) : detail && detail.campaigns.length > 0 ? (
                    <div>
                        <SectionLabel>Campaigns ({detail.campaigns.length})</SectionLabel>
                        <div className="space-y-1.5">
                            {detail.campaigns.map((c) => (
                                <div key={c.id} className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)]">
                                    <span className="text-xs font-medium text-[var(--text-primary)] truncate max-w-[160px]">{c.name}</span>
                                    <span className={[
                                        "text-[10px] font-semibold px-1.5 py-0.5 rounded-full",
                                        c.status === "ACTIVE" ? "bg-emerald-400/10 text-emerald-400" :
                                        c.status === "PAUSED" ? "bg-amber-400/10 text-amber-400" :
                                        "bg-[var(--surface)] text-[var(--text-muted)]",
                                    ].join(" ")}>
                                        {c.status}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : null}

                {/* Edit settings */}
                <div>
                    <SectionLabel>Settings</SectionLabel>
                    <div className="space-y-3">
                        <div>
                            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Label</label>
                            <input
                                type="text"
                                className={inputCls}
                                value={editLabel}
                                onChange={(e) => setEditLabel(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Daily send limit</label>
                            <input
                                type="number"
                                min={1}
                                max={10000}
                                className={inputCls}
                                value={editLimit}
                                onChange={(e) => setEditLimit(e.target.value)}
                            />
                        </div>
                        <div className="p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border)]">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-medium text-[var(--text-primary)]">Warmup</p>
                                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                                        {mailbox.warmupEnabled ? "Active — gradually increasing volume" : "Disabled"}
                                    </p>
                                </div>
                                <button
                                    onClick={handleToggleWarmup}
                                    disabled={saving}
                                    role="switch"
                                    aria-checked={mailbox.warmupEnabled}
                                    className={[
                                        "relative w-10 h-5 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] flex-shrink-0 disabled:opacity-50",
                                        mailbox.warmupEnabled ? "bg-emerald-500" : "bg-[var(--surface)] border border-[var(--border)]",
                                    ].join(" ")}
                                >
                                    <span className={[
                                        "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200",
                                        mailbox.warmupEnabled ? "translate-x-5" : "translate-x-0.5",
                                    ].join(" ")} />
                                </button>
                            </div>
                            <WarmupProgress mailbox={mailbox as WarmupMailbox} />
                        </div>

                        {saveError && (
                            <div className="flex items-start gap-2 p-3 bg-[var(--red-glow)] border border-[var(--border-red)] rounded-lg">
                                <svg className="flex-shrink-0 mt-0.5 text-[var(--red)]" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                                </svg>
                                <p className="text-xs text-[var(--red)]">{saveError}</p>
                            </div>
                        )}

                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="w-full h-9 rounded-lg text-sm font-semibold text-white bg-[var(--red)] hover:bg-[var(--red-dim)] active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-150 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                        >
                            {saving ? (
                                <>
                                    <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                                    </svg>
                                    Saving…
                                </>
                            ) : "Save changes"}
                        </button>
                    </div>
                </div>

                {/* Danger zone */}
                <div className="pt-2 border-t border-[var(--border)]">
                    <SectionLabel>Danger zone</SectionLabel>
                    {!confirmDelete ? (
                        <button
                            onClick={() => setConfirmDelete(true)}
                            className="w-full h-9 rounded-lg text-xs font-semibold text-red-400 border border-red-400/20 hover:bg-red-400/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                        >
                            Remove mailbox
                        </button>
                    ) : (
                        <div className="space-y-2">
                            <p className="text-xs text-[var(--text-muted)]">
                                This will disconnect the mailbox and remove it from all campaigns. This cannot be undone.
                            </p>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setConfirmDelete(false)}
                                    className="flex-1 h-9 rounded-lg text-xs font-medium text-[var(--text-secondary)] bg-[var(--surface-2)] border border-[var(--border)] hover:bg-[var(--surface)] transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleDelete}
                                    disabled={deleting}
                                    className="flex-1 h-9 rounded-lg text-xs font-semibold text-white bg-red-500 hover:bg-red-600 disabled:opacity-60 transition-colors flex items-center justify-center gap-1.5"
                                >
                                    {deleting ? (
                                        <>
                                            <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                                            </svg>
                                            Removing…
                                        </>
                                    ) : "Yes, remove"}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
