"use client";

import { SenderMailbox } from "@/app/api/mailbox/Mailbox.Types";
import { HEALTH_CONFIG } from "@/app/api/src/lib/domains/domainConfig";

interface StatRowProps {
    label: string;
    value: string;
    valueClass?: string;
}

function StatRow({ label, value, valueClass }: StatRowProps) {
    return (
        <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-muted)]">{label}</span>
            <span className={`text-xs font-semibold tabular-nums ${valueClass ?? "text-[var(--text-primary)]"}`}>
                {value}
            </span>
        </div>
    );
}

function ProviderIcon({ type }: { type: "GMAIL" | "OUTLOOK" | "SMTP" }) {
    if (type === "GMAIL") {
        return (
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.47 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
        );
    }
    if (type === "OUTLOOK") {
        return (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect width="13" height="13" x="1" y="6" rx="1.5" fill="#0078D4" />
                <path fill="#50D9FF" d="M7.5 9.5a3 3 0 1 0 0 5 3 3 0 0 0 0-5Z" />
                <rect width="11" height="11" x="12" y="3" rx="1.5" fill="#0078D4" opacity=".9" />
                <path stroke="#fff" strokeWidth="1.2" strokeLinecap="round" d="M14 8h7M14 11h7M14 14h4" />
            </svg>
        );
    }
    // SMTP
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
        </svg>
    );
}

const PROVIDER_LABEL: Record<string, string> = {
    GMAIL: "Gmail",
    OUTLOOK: "Outlook",
    SMTP: "SMTP",
};

interface MailboxCardProps {
    mailbox: SenderMailbox;
    onSelect: (mailbox: SenderMailbox) => void;
    onToggleWarmup: (mailbox: SenderMailbox) => void;
    onResetCount: (mailbox: SenderMailbox) => void;
    loading?: boolean;
}

export function MailboxCard({
    mailbox,
    onSelect,
    onToggleWarmup,
    onResetCount,
    loading = false,
}: MailboxCardProps) {
    const cfg = HEALTH_CONFIG[mailbox.health];
    const sentPct = mailbox.dailyLimit > 0
        ? Math.min(Math.round((mailbox.currentSent / mailbox.dailyLimit) * 100), 100)
        : 0;
    const repColor =
        mailbox.reputationScore >= 80
            ? "text-emerald-400"
            : mailbox.reputationScore >= 50
                ? "text-amber-400"
                : "text-red-400";
    const bounceWarning = mailbox.bounceRate > 0.05;
    const complaintWarning = mailbox.complaintRate > 0.001;

    return (
        <div
            className={[
                "bg-[var(--surface)] border rounded-xl p-5 flex flex-col gap-4 transition-all duration-150",
                "hover:border-[var(--border-red)] hover:shadow-lg hover:shadow-black/20",
                cfg.ring,
            ].join(" ")}
        >
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                        <span className={`flex-shrink-0 ${cfg.text}`}>
                            <ProviderIcon type={mailbox.providerType} />
                        </span>
                        <button
                            onClick={() => onSelect(mailbox)}
                            className="text-sm font-semibold text-[var(--text-primary)] hover:text-[var(--red)] transition-colors duration-150 truncate block max-w-[180px] focus-visible:outline-none focus-visible:underline text-left"
                            title={mailbox.emailAddress}
                        >
                            {mailbox.label}
                        </button>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] truncate max-w-[200px]" title={mailbox.emailAddress}>
                        {mailbox.emailAddress}
                    </p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                        {PROVIDER_LABEL[mailbox.providerType]} · {mailbox._count?.campaigns ?? 0} campaign{(mailbox._count?.campaigns ?? 0) !== 1 ? "s" : ""}
                    </p>
                </div>
                {/* Health badge */}
                <span
                    className={[
                        "inline-flex items-center gap-1.5 font-semibold rounded-full text-xs px-2.5 py-1 flex-shrink-0",
                        cfg.badge,
                    ].join(" ")}
                >
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} aria-hidden="true" />
                    {cfg.label}
                </span>
            </div>

            {/* Daily send bar */}
            <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--text-muted)]">Daily send</span>
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
                        aria-label={`${sentPct}% of daily limit used`}
                    />
                </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                <StatRow label="Reputation" value={`${Math.round(mailbox.reputationScore)}`} valueClass={repColor} />
                <StatRow label="Total sent" value={mailbox.totalSent.toLocaleString()} />
                <StatRow
                    label="Bounce rate"
                    value={`${(mailbox.bounceRate * 100).toFixed(2)}%`}
                    valueClass={bounceWarning ? "text-red-400" : "text-[var(--text-primary)]"}
                />
                <StatRow
                    label="Complaint"
                    value={`${(mailbox.complaintRate * 100).toFixed(3)}%`}
                    valueClass={complaintWarning ? "text-red-400" : "text-[var(--text-primary)]"}
                />
            </div>

            {/* Footer actions */}
            <div className="flex items-center justify-between pt-1 border-t border-[var(--border)]">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => onToggleWarmup(mailbox)}
                        disabled={loading}
                        role="switch"
                        aria-checked={mailbox.warmupEnabled}
                        aria-label={`${mailbox.warmupEnabled ? "Disable" : "Enable"} warmup for ${mailbox.label}`}
                        className={[
                            "relative w-8 h-4 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] disabled:opacity-50",
                            mailbox.warmupEnabled ? "bg-emerald-500" : "bg-[var(--surface-2)] border border-[var(--border)]",
                        ].join(" ")}
                    >
                        <span
                            className={[
                                "absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform duration-200",
                                mailbox.warmupEnabled ? "translate-x-4" : "translate-x-0.5",
                            ].join(" ")}
                        />
                    </button>
                    <span className="text-xs text-[var(--text-muted)]">Warmup</span>
                </div>

                <div className="flex items-center gap-1">
                    <button
                        onClick={() => onResetCount(mailbox)}
                        disabled={loading}
                        title="Reset today's send count"
                        aria-label={`Reset daily count for ${mailbox.label}`}
                        className="flex items-center justify-center w-7 h-7 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] disabled:opacity-40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                            <path d="M3 3v5h5" />
                        </svg>
                    </button>
                    <button
                        onClick={() => onSelect(mailbox)}
                        title="View details"
                        aria-label={`View details for ${mailbox.label}`}
                        className="flex items-center justify-center w-7 h-7 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );
}
