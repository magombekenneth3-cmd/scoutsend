"use client";

import type { LearningEvent } from "@/app/api/learning/learningApi";
import { EventTypeBadge, OutcomeBadge } from "@/app/components/learning/learningBadge";

function ScoreGauge({
    value,
    label,
    invert,
}: {
    value: number | null;
    label: string;
    invert?: boolean;
}) {
    if (value == null) return null;
    const pct = Math.round(value * 100);
    const bad = invert ? pct > 60 : pct < 40;
    const color = bad ? "bg-red-500" : pct >= 70 ? "bg-emerald-500" : "bg-amber-400";
    return (
        <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">{label}</span>
            <div
                className="relative w-16 h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden flex-shrink-0"
                role="meter"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${label}: ${pct}%`}
            >
                <div
                    className={`absolute left-0 top-0 h-full rounded-full ${color}`}
                    style={{ width: `${pct}%` }}
                />
            </div>
            <span className="text-xs tabular-nums text-[var(--text-secondary)]">{pct}%</span>
        </div>
    );
}

function formatDate(iso: string): string {
    return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(iso));
}

interface LearningEventRowProps {
    event: LearningEvent;
    selected: boolean;
    onSelect: () => void;
}

export function LearningEventRow({
    event,
    selected,
    onSelect,
}: LearningEventRowProps) {
    const msg = event.outreachMessage;
    const meta = event.metadata;

    return (
        <tr
            onClick={onSelect}
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && onSelect()}
            aria-selected={selected}
            className={[
                "group cursor-pointer border-b border-[var(--border)] transition-colors duration-100",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--red)]",
                selected
                    ? "bg-[var(--red-glow)]"
                    : "hover:bg-[var(--surface-2)]",
            ].join(" ")}
        >
            <td className="pl-5 pr-3 py-3.5 w-2">
                <div
                    className={[
                        "w-1.5 h-1.5 rounded-full flex-shrink-0",
                        event.outcome === "PENDING_REVIEW"
                            ? "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)]"
                            : "bg-transparent",
                    ].join(" ")}
                    aria-hidden="true"
                />
            </td>

            <td className="px-3 py-3.5">
                <EventTypeBadge type={event.eventType} />
            </td>

            <td className="px-3 py-3.5 max-w-[220px]">
                {msg ? (
                    <div>
                        <p className="text-sm text-[var(--text-primary)] truncate leading-snug">
                            {msg.subject}
                        </p>
                        <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">
                            {msg.lead.firstName} {msg.lead.lastName} · {msg.lead.companyName}
                        </p>
                    </div>
                ) : event.outreachMessageId ? (
                    <span className="text-xs text-[var(--text-muted)] font-mono">
                        {event.outreachMessageId.slice(0, 12)}…
                    </span>
                ) : (
                    <span className="text-xs text-[var(--text-muted)]">—</span>
                )}
            </td>

            <td className="px-3 py-3.5">
                <div className="space-y-1">
                    <ScoreGauge
                        value={msg?.spamRiskScore ?? meta?.spamRiskScore ?? null}
                        label="Spam"
                        invert
                    />
                    <ScoreGauge
                        value={msg?.personalizationScore ?? meta?.personalizationScore ?? null}
                        label="Pers."
                    />
                </div>
            </td>

            <td className="px-3 py-3.5">
                <OutcomeBadge outcome={event.outcome} />
            </td>

            <td className="px-3 pr-5 py-3.5 text-xs text-[var(--text-muted)] whitespace-nowrap">
                {formatDate(event.createdAt)}
            </td>
        </tr>
    );
}