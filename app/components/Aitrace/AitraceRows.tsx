"use client";

import { timeAgo, formatMs, formatTokens, confidenceColor, latencyColor, agentShortName } from "@/app/api/ai-traces/utils";
import type { AITrace } from "@/app/api/ai-traces/types"

interface AITraceRowProps {
    trace: AITrace;
    selected: boolean;
    onSelect: () => void;
    onDelete: (id: string) => void;
    deleting: boolean;
}

export function AITraceRow({ trace, selected, onSelect, onDelete, deleting }: AITraceRowProps) {
    const confColor = confidenceColor(trace.confidence);
    const latColor = latencyColor(trace.latencyMs);

    return (
        <tr
            className={[
                "group border-b border-[var(--border)] cursor-pointer transition-colors duration-100",
                selected ? "bg-[var(--red-glow)]" : "hover:bg-[var(--surface-2)]",
            ].join(" ")}
            onClick={onSelect}
        >
            <td className="px-4 py-3 max-w-[160px]">
                <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--red)] flex-shrink-0" aria-hidden="true" />
                    <span className="text-xs font-medium text-[var(--text-primary)] truncate" title={trace.agentName}>
                        {agentShortName(trace.agentName)}
                    </span>
                </div>
            </td>

            <td className="px-4 py-3">
                <span className="text-xs font-mono text-[var(--text-secondary)] bg-[var(--surface-2)] px-1.5 py-0.5 rounded whitespace-nowrap">
                    {trace.model}
                </span>
            </td>

            <td className="px-4 py-3 tabular-nums">
                <span className={`text-xs font-semibold ${latColor}`}>{formatMs(trace.latencyMs)}</span>
            </td>

            <td className="px-4 py-3 tabular-nums">
                <span className="text-xs text-[var(--text-secondary)]">{formatTokens(trace.tokenUsage)}</span>
            </td>

            <td className="px-4 py-3">
                {trace.confidence !== null ? (
                    <div className="flex items-center gap-2">
                        <div className="w-14 h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all ${trace.confidence >= 0.75 ? "bg-emerald-400" : trace.confidence >= 0.5 ? "bg-amber-400" : "bg-red-400"}`}
                                style={{ width: `${Math.round(trace.confidence * 100)}%` }}
                                role="progressbar"
                                aria-valuenow={Math.round(trace.confidence * 100)}
                                aria-valuemin={0}
                                aria-valuemax={100}
                            />
                        </div>
                        <span className={`text-xs font-semibold tabular-nums ${confColor}`}>
                            {Math.round(trace.confidence * 100)}%
                        </span>
                    </div>
                ) : (
                    <span className="text-xs text-[var(--text-muted)]">—</span>
                )}
            </td>

            <td className="px-4 py-3 tabular-nums">
                <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">{timeAgo(trace.createdAt)}</span>
            </td>

            <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                <button
                    onClick={() => onDelete(trace.id)}
                    disabled={deleting}
                    aria-label={`Delete trace ${trace.id}`}
                    title="Delete trace"
                    className="flex items-center justify-center w-7 h-7 rounded-md text-[var(--text-muted)] hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover:opacity-100 disabled:opacity-40 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                >
                    {deleting ? (
                        <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                    ) : (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        </svg>
                    )}
                </button>
            </td>
        </tr>
    );
}