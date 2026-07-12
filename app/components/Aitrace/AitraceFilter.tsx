"use client";

import type { TraceFilters } from "@/app/api/ai-traces/types";

interface AITraceFiltersProps {
    filters: TraceFilters;
    agentNames: string[];
    models: string[];
    onChange: (filters: TraceFilters) => void;
    onReset: () => void;
}

export function AITraceFilters({ filters, agentNames, models, onChange, onReset }: AITraceFiltersProps) {
    function set<K extends keyof TraceFilters>(key: K, value: TraceFilters[K]) {
        onChange({ ...filters, [key]: value, page: 1 });
    }

    const inputCls =
        "bg-[var(--surface)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-red)] transition-colors";
    const selectCls = `${inputCls} cursor-pointer`;

    const hasFilters =
        filters.agentName || filters.model || filters.minConfidence ||
        filters.maxConfidence || filters.from || filters.to;

    return (
        <div className="flex items-center gap-2 px-6 py-3 border-b border-[var(--border)] bg-[var(--navy-mid)] flex-wrap flex-shrink-0">
            <select
                value={filters.agentName}
                onChange={(e) => set("agentName", e.target.value)}
                aria-label="Filter by agent"
                className={selectCls}
            >
                <option value="">All agents</option>
                {agentNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>

            <select
                value={filters.model}
                onChange={(e) => set("model", e.target.value)}
                aria-label="Filter by model"
                className={selectCls}
            >
                <option value="">All models</option>
                {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>

            <div className="flex items-center gap-1.5">
                <span className="text-xs text-[var(--text-muted)]">Confidence</span>
                <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    placeholder="min"
                    value={filters.minConfidence}
                    onChange={(e) => set("minConfidence", e.target.value)}
                    aria-label="Minimum confidence"
                    className={`${inputCls} w-16`}
                />
                <span className="text-xs text-[var(--text-muted)]">–</span>
                <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    placeholder="max"
                    value={filters.maxConfidence}
                    onChange={(e) => set("maxConfidence", e.target.value)}
                    aria-label="Maximum confidence"
                    className={`${inputCls} w-16`}
                />
            </div>

            <div className="flex items-center gap-1.5">
                <span className="text-xs text-[var(--text-muted)]">From</span>
                <input
                    type="date"
                    value={filters.from}
                    onChange={(e) => set("from", e.target.value)}
                    aria-label="From date"
                    className={`${inputCls} w-32`}
                />
                <span className="text-xs text-[var(--text-muted)]">to</span>
                <input
                    type="date"
                    value={filters.to}
                    onChange={(e) => set("to", e.target.value)}
                    aria-label="To date"
                    className={`${inputCls} w-32`}
                />
            </div>

            {hasFilters && (
                <button
                    onClick={onReset}
                    className="text-xs font-medium text-[var(--red)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] rounded px-1"
                >
                    Clear filters
                </button>
            )}

            <div className="flex items-center gap-1.5 ml-auto">
                <span className="text-xs text-[var(--text-muted)]">Per page</span>
                <select
                    value={filters.limit}
                    onChange={(e) => set("limit", Number(e.target.value))}
                    aria-label="Results per page"
                    className={selectCls}
                >
                    {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
            </div>
        </div>
    );
}