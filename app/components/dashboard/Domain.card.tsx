"use client";

import type { DomainHealth } from "./badges";
import { DomainBadge } from "./badges";

interface DomainCardProps {
    domain: string;
    health: DomainHealth;
    reputationScore: number;
    sentToday: number;
    dailyLimit: number;
    bounceRate: number;
    warmupEnabled?: boolean;
    warmupLimit?: number;
}

const healthRingColor: Record<DomainHealth, string> = {
    HEALTHY: "stroke-emerald-400",
    DEGRADED: "stroke-amber-400",
    WARNING: "stroke-orange-400",
    CRITICAL: "stroke-[var(--red)]",
};

function ScoreRing({ score, health }: { score: number; health: DomainHealth }) {
    const r = 18;
    const circ = 2 * Math.PI * r;
    const filled = (score / 100) * circ;

    return (
        <svg
            width="48" height="48" viewBox="0 0 48 48"
            role="img"
            aria-label={`Reputation score: ${score} out of 100`}
            focusable="false"
        >
            <circle cx="24" cy="24" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3" />
            <circle
                cx="24" cy="24" r={r}
                fill="none"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={`${filled} ${circ}`}
                transform="rotate(-90 24 24)"
                className={healthRingColor[health]}
            />
            <text
                x="24" y="24"
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="11"
                fontWeight="600"
                fill="var(--text-primary)"
                fontFamily="var(--font-display)"
                aria-hidden="true"
            >
                {score}
            </text>
        </svg>
    );
}

export function DomainCard({
    domain,
    health,
    reputationScore,
    sentToday,
    dailyLimit,
    bounceRate,
    warmupEnabled = false,
    warmupLimit,
}: DomainCardProps) {
    const effectiveLimit = warmupEnabled && warmupLimit != null ? warmupLimit : dailyLimit;
    const sendPct = Math.min((sentToday / Math.max(effectiveLimit, 1)) * 100, 100);

    return (
        <article
            aria-label={`${domain} — ${health.toLowerCase()}, reputation ${reputationScore}`}
            className="flex items-center gap-4 p-4 bg-[var(--surface)] border border-[var(--border)] rounded-xl hover:border-[var(--border-red)] hover:-translate-y-0.5 transition-all duration-150 group"

        >
            <div className="flex-shrink-0">
                <ScoreRing score={reputationScore} health={health} />
            </div>

            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-medium text-[var(--text-primary)] truncate">{domain}</p>
                    <DomainBadge health={health} />
                    {warmupEnabled && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded bg-amber-400/10 text-amber-400 border border-amber-400/20 flex-shrink-0">
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                            </svg>
                            Warmup
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    <div
                        className="flex-1 h-1 bg-[var(--surface-2)] rounded-full overflow-hidden"
                        aria-hidden="true"
                    >
                        <div
                            className={`h-full rounded-full transition-all duration-500 ${warmupEnabled ? "bg-amber-400" : "bg-[var(--red)]"}`}
                            style={{ width: `${sendPct}%` }}
                        />
                    </div>
                    <span
                        className="text-xs text-[var(--text-muted)] tabular-nums whitespace-nowrap flex-shrink-0"
                        aria-label={`${sentToday} of ${effectiveLimit} emails sent today${warmupEnabled ? " (warmup cap)" : ""}`}
                    >
                        {sentToday}/{effectiveLimit}
                        {warmupEnabled && warmupLimit != null && warmupLimit < dailyLimit && (
                            <span className="text-[var(--text-muted)] opacity-60"> cap</span>
                        )}
                    </span>
                </div>

                <p className="text-xs text-[var(--text-muted)] mt-1">
                    Bounce{" "}
                    <span
                        className="text-[var(--text-secondary)]"
                        aria-label={`Bounce rate ${bounceRate.toFixed(1)} percent`}
                    >
                        {bounceRate.toFixed(1)}%
                    </span>
                </p>
            </div>
        </article>
    );
}
