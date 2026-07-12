import { AITraceStats } from "@/app/api/ai-traces/types";
import { confidenceColor, formatMs, formatTokens } from "@/app/api/ai-traces/utils";



interface AITraceStatsBarProps {
    stats: AITraceStats;
}

interface StatTileProps {
    label: string;
    value: string;
    sub?: string;
    valueClass?: string;
}

function StatTile({ label, value, sub, valueClass }: StatTileProps) {
    return (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex flex-col gap-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">{label}</p>
            <p className={`text-xl font-bold tabular-nums font-display ${valueClass ?? "text-[var(--text-primary)]"}`}>{value}</p>
            {sub && <p className="text-xs text-[var(--text-muted)]">{sub}</p>}
        </div>
    );
}

export function AITraceStatsBar({ stats }: AITraceStatsBarProps) {
    const { totals } = stats;
    const confColor = confidenceColor(totals.avgConfidence);

    return (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 px-6 py-4 border-b border-[var(--border)] bg-[var(--navy-mid)] flex-shrink-0">
            <StatTile label="Total calls" value={totals.count.toLocaleString()} />
            <StatTile
                label="Avg latency"
                value={formatMs(Math.round(totals.avgLatencyMs))}
                valueClass={totals.avgLatencyMs < 2000 ? "text-emerald-400" : totals.avgLatencyMs < 5000 ? "text-amber-400" : "text-red-400"}
            />
            <StatTile
                label="Avg confidence"
                value={totals.avgConfidence !== null ? `${Math.round(totals.avgConfidence * 100)}%` : "—"}
                valueClass={confColor}
            />
            <StatTile
                label="Total tokens"
                value={formatTokens(totals.totalTokens)}
                sub={`~${formatTokens(Math.round(totals.avgTokensPerCall))} avg/call`}
            />
            <StatTile
                label="Low confidence"
                value={String(stats.lowConfidenceTraces.length)}
                sub="< 50% confidence"
                valueClass={stats.lowConfidenceTraces.length > 0 ? "text-amber-400" : "text-[var(--text-primary)]"}
            />
            <StatTile
                label="Agents"
                value={String(stats.byAgent.length)}
                sub={`${stats.byModel.length} model${stats.byModel.length !== 1 ? "s" : ""}`}
            />
        </div>
    );
}