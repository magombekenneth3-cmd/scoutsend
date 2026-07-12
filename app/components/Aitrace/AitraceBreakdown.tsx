import { formatMs, formatTokens, confidenceColor } from "@/app/api/ai-traces/utils";
import type { AgentStat, ModelStat } from "@/app/api/ai-traces/types";

interface AITraceAgentBreakdownProps {
    byAgent: AgentStat[];
    byModel: ModelStat[];
}

export function AITraceAgentBreakdown({ byAgent, byModel }: AITraceAgentBreakdownProps) {
    const maxCount = Math.max(...byAgent.map((a) => a._count.id), 1);

    return (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 px-6 py-4 border-b border-[var(--border)] bg-[var(--navy-mid)] flex-shrink-0">
            <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">By agent</p>
                <div className="space-y-1.5">
                    {byAgent.map((agent) => {
                        const pct = Math.round((agent._count.id / maxCount) * 100);
                        const conf = agent._avg.confidence;
                        return (
                            <div key={agent.agentName} className="flex items-center gap-3">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between mb-0.5">
                                        <span className="text-xs text-[var(--text-primary)] truncate">{agent.agentName}</span>
                                        <span className="text-xs tabular-nums text-[var(--text-muted)] ml-2 flex-shrink-0">{agent._count.id.toLocaleString()}</span>
                                    </div>
                                    <div className="h-1 w-full rounded-full bg-[var(--surface-2)] overflow-hidden">
                                        <div className="h-full rounded-full bg-[var(--red)] transition-all duration-500" style={{ width: `${pct}%` }} />
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0 text-xs tabular-nums">
                                    <span className="text-[var(--text-muted)]">{formatMs(agent._avg.latencyMs ? Math.round(agent._avg.latencyMs) : null)}</span>
                                    {conf !== null && <span className={confidenceColor(conf)}>{Math.round(conf * 100)}%</span>}
                                    <span className="text-[var(--text-muted)]">{formatTokens(agent._avg.tokenUsage ? Math.round(agent._avg.tokenUsage) : null)}</span>
                                </div>
                            </div>
                        );
                    })}
                    {byAgent.length === 0 && <p className="text-xs text-[var(--text-muted)]">No data</p>}
                </div>
            </div>

            <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">By model</p>
                <div className="space-y-1.5">
                    {byModel.map((m) => {
                        const pct = Math.round((m._count.id / maxCount) * 100);
                        return (
                            <div key={m.model} className="flex items-center gap-3">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between mb-0.5">
                                        <span className="text-xs font-mono text-[var(--text-secondary)] truncate">{m.model}</span>
                                        <span className="text-xs tabular-nums text-[var(--text-muted)] ml-2 flex-shrink-0">{m._count.id.toLocaleString()}</span>
                                    </div>
                                    <div className="h-1 w-full rounded-full bg-[var(--surface-2)] overflow-hidden">
                                        <div className="h-full rounded-full bg-blue-400/70 transition-all duration-500" style={{ width: `${pct}%` }} />
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0 text-xs tabular-nums">
                                    <span className="text-[var(--text-muted)]">{formatMs(m._avg.latencyMs ? Math.round(m._avg.latencyMs) : null)}</span>
                                    <span className="text-[var(--text-muted)]">{formatTokens(m._sum.tokenUsage)}</span>
                                </div>
                            </div>
                        );
                    })}
                    {byModel.length === 0 && <p className="text-xs text-[var(--text-muted)]">No data</p>}
                </div>
            </div>
        </div>
    );
}