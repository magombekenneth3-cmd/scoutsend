"use client";

import { SenderDomain } from "@/app/api/src/lib/domains/domain.type";
import { HEALTH_CONFIG } from "@/app/api/src/lib/domains/domainConfig";
import { DomainHealthBadge } from "./DomainHealthBadge";



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

interface DomainCardProps {
    domain: SenderDomain;
    onSelect: (domain: SenderDomain) => void;
    onToggleWarmup: (domain: SenderDomain) => void;
    onResetCount: (domain: SenderDomain) => void;
    loading?: boolean;
}

export function DomainCard({
    domain,
    onSelect,
    onToggleWarmup,
    onResetCount,
    loading = false,
}: DomainCardProps) {
    const cfg = HEALTH_CONFIG[domain.health];
    const sentPct = domain.dailyLimit > 0
        ? Math.min(Math.round((domain.currentSent / domain.dailyLimit) * 100), 100)
        : 0;
    const repColor =
        domain.reputationScore >= 80
            ? "text-emerald-400"
            : domain.reputationScore >= 50
                ? "text-amber-400"
                : "text-red-400";
    const bounceWarning = domain.bounceRate > 0.05;
    const complaintWarning = domain.complaintRate > 0.001;
    const dnsWarning =
        domain.spfValid === false ||
        domain.dkimValid === false ||
        domain.dmarcValid === false;
    const dnsUnchecked =
        domain.spfValid === null &&
        domain.dkimValid === null &&
        domain.dmarcValid === null;

    return (
        <div
            className={[
                "bg-[var(--surface)] border rounded-xl p-5 flex flex-col gap-4 transition-all duration-150",
                "hover:border-[var(--border-red)] hover:shadow-lg hover:shadow-black/20",
                cfg.ring,
            ].join(" ")}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <button
                        onClick={() => onSelect(domain)}
                        className="text-sm font-semibold text-[var(--text-primary)] hover:text-[var(--red)] transition-colors duration-150 truncate block max-w-[180px] focus-visible:outline-none focus-visible:underline text-left"
                        title={domain.domain}
                    >
                        {domain.domain}
                    </button>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                        {domain._count.campaigns} campaign{domain._count.campaigns !== 1 ? "s" : ""}
                    </p>
                </div>
                <DomainHealthBadge health={domain.health} />
            </div>

            <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--text-muted)]">Daily send</span>
                    <span className="text-xs font-semibold tabular-nums text-[var(--text-secondary)]">
                        {domain.currentSent.toLocaleString()} / {domain.dailyLimit.toLocaleString()}
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

            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                <StatRow label="Reputation" value={`${Math.round(domain.reputationScore)}`} valueClass={repColor} />
                <StatRow label="Total sent" value={domain.totalSent.toLocaleString()} />
                <StatRow
                    label="Bounce rate"
                    value={`${(domain.bounceRate * 100).toFixed(2)}%`}
                    valueClass={bounceWarning ? "text-red-400" : "text-[var(--text-primary)]"}
                />
                <StatRow
                    label="Complaint"
                    value={`${(domain.complaintRate * 100).toFixed(3)}%`}
                    valueClass={complaintWarning ? "text-red-400" : "text-[var(--text-primary)]"}
                />
                {dnsWarning && (
                    <div className="col-span-2 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" aria-hidden="true" />
                        <span className="text-[10px] text-amber-400">
                            DNS issue — {[
                                !domain.spfValid && "SPF",
                                !domain.dkimValid && "DKIM",
                                !domain.dmarcValid && "DMARC",
                            ].filter(Boolean).join(", ")} missing
                        </span>
                    </div>
                )}
                {dnsUnchecked && (
                    <div className="col-span-2 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] flex-shrink-0" aria-hidden="true" />
                        <span className="text-[10px] text-[var(--text-muted)]">DNS not yet checked</span>
                    </div>
                )}
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-[var(--border)]">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => onToggleWarmup(domain)}
                        disabled={loading}
                        role="switch"
                        aria-checked={domain.warmupEnabled}
                        aria-label={`${domain.warmupEnabled ? "Disable" : "Enable"} warmup for ${domain.domain}`}
                        className={[
                            "relative w-8 h-4 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] disabled:opacity-50",
                            domain.warmupEnabled ? "bg-emerald-500" : "bg-[var(--surface-2)] border border-[var(--border)]",
                        ].join(" ")}
                    >
                        <span
                            className={[
                                "absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform duration-200",
                                domain.warmupEnabled ? "translate-x-4" : "translate-x-0.5",
                            ].join(" ")}
                        />
                    </button>
                    <span className="text-xs text-[var(--text-muted)]">Warmup</span>
                </div>

                <div className="flex items-center gap-1">
                    <button
                        onClick={() => onResetCount(domain)}
                        disabled={loading}
                        title="Reset today's send count"
                        aria-label={`Reset daily count for ${domain.domain}`}
                        className="flex items-center justify-center w-7 h-7 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] disabled:opacity-40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                            <path d="M3 3v5h5" />
                        </svg>
                    </button>
                    <button
                        onClick={() => onSelect(domain)}
                        title="View details"
                        aria-label={`View details for ${domain.domain}`}
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