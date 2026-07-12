export interface AITrace {
    id: string;
    agentName: string;
    model: string;
    latencyMs: number | null;
    tokenUsage: number | null;
    confidence: number | null;
    metadata: Record<string, unknown> | null;
    createdAt: string;
}

export interface AITraceDetail extends AITrace {
    prompt: string;
    response: string;
}

export interface AITracesResponse {
    data: AITrace[];
    meta: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
    };
}

export interface AgentStat {
    agentName: string;
    _count: { id: number };
    _avg: { latencyMs: number | null; confidence: number | null; tokenUsage: number | null };
    _sum: { tokenUsage: number | null };
}

export interface ModelStat {
    model: string;
    _count: { id: number };
    _avg: { latencyMs: number | null; tokenUsage: number | null };
    _sum: { tokenUsage: number | null };
}

export interface AITraceStats {
    totals: {
        count: number;
        totalTokens: number;
        totalLatencyMs: number;
        avgLatencyMs: number;
        avgConfidence: number | null;
        avgTokensPerCall: number;
    };
    byAgent: AgentStat[];
    byModel: ModelStat[];
    lowConfidenceTraces: AITrace[];
}

export interface TraceFilters {
    agentName: string;
    model: string;
    minConfidence: string;
    maxConfidence: string;
    from: string;
    to: string;
    page: number;
    limit: number;
}