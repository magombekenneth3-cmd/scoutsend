"use client";

import { useState, useEffect, useCallback, useId } from "react";
import {
    ResponsiveContainer,
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
} from "recharts";

interface DayBucket {
    day: string;
    sent: number;
    opens: number;
    replies: number;
}

interface TooltipPayloadEntry {
    name: string;
    value: number;
    color: string;
}

interface CustomTooltipProps {
    active?: boolean;
    payload?: TooltipPayloadEntry[];
    label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl px-4 py-3 shadow-lg">
            <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-widest mb-2">
                {label}
            </p>
            {payload.map((entry) => (
                <div key={entry.name} className="flex items-center gap-2 text-sm">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: entry.color }} />
                    <span className="text-[var(--text-secondary)] capitalize">{entry.name}</span>
                    <span className="ml-auto font-semibold text-[var(--text-primary)] tabular-nums pl-4">
                        {entry.value.toLocaleString()}
                    </span>
                </div>
            ))}
        </div>
    );
}

const RANGES = [
    { label: "7d", days: 7 },
    { label: "14d", days: 14 },
    { label: "30d", days: 30 },
] as const;

interface CampaignOption {
    id: string;
    name: string;
}

interface DashboardChartProps {
    campaigns: CampaignOption[];
}

export function DashboardChart({ campaigns }: DashboardChartProps) {
    const [data, setData] = useState<DayBucket[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [days, setDays] = useState<7 | 14 | 30>(7);
    const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
    const descId = useId();

    const fetchStats = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const query = new URLSearchParams({
                days: String(days),
            });
            if (selectedCampaignId) {
                query.set("campaignId", selectedCampaignId);
            }
            const res = await fetch(`/api/dashboard/pipeline-chart?${query}`);
            if (!res.ok) throw new Error(`Server error ${res.status}`);
            const json = await res.json();
            setData(json.data ?? []);
        } catch {
            setError("Failed to load chart data.");
        } finally {
            setLoading(false);
        }
    }, [days, selectedCampaignId]);

    useEffect(() => {
        fetchStats();
    }, [fetchStats]);

    const isEmpty = !loading && !error && data.every(
        (d) => d.sent === 0 && d.opens === 0 && d.replies === 0
    );

    return (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 flex-1 flex flex-col justify-between">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6">
                <div>
                    <h2 className="text-sm font-semibold text-[var(--text-primary)] font-display">
                        Pipeline Activity
                    </h2>
                    <p id={descId} className="text-xs text-[var(--text-muted)] mt-0.5">
                        Sent · Opens · Replies
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    <select
                        value={selectedCampaignId}
                        onChange={(e) => setSelectedCampaignId(e.target.value)}
                        className="text-xs px-2 py-1.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] transition-all"
                        aria-label="Filter by campaign"
                    >
                        <option value="">All Campaigns</option>
                        {campaigns.map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.name}
                            </option>
                        ))}
                    </select>

                    <div className="flex gap-3" aria-hidden="true">
                        {[
                            { label: "Sent", color: "#e94560" },
                            { label: "Opens", color: "#38bdf8" },
                            { label: "Replies", color: "#4ade80" },
                        ].map(({ label, color }) => (
                            <div key={label} className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                                <span className="text-xs text-[var(--text-secondary)]">{label}</span>
                            </div>
                        ))}
                    </div>

                    <div
                        className="flex items-center bg-[var(--surface-2)] rounded-lg border border-[var(--border)] p-0.5"
                        role="group"
                        aria-label="Time range"
                    >
                        {RANGES.map((r) => (
                            <button
                                key={r.days}
                                onClick={() => setDays(r.days)}
                                aria-pressed={days === r.days}
                                className={[
                                    "text-xs px-2.5 py-1 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]",
                                    days === r.days
                                        ? "bg-[var(--surface)] text-[var(--text-primary)] shadow-sm font-semibold"
                                        : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]",
                                ].join(" ")}
                            >
                                {r.label}
                            </button>
                        ))}
                    </div>

                    <button
                        onClick={fetchStats}
                        disabled={loading}
                        aria-label="Refresh chart"
                        className="flex items-center justify-center w-7 h-7 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        <svg
                            width="13" height="13" viewBox="0 0 24 24" fill="none"
                            stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                            className={loading ? "animate-spin" : ""}
                            aria-hidden="true"
                        >
                            <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                            <path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                        </svg>
                    </button>
                </div>
            </div>

            <div
                className="w-full relative min-h-[200px] flex-1"
                role="img"
                aria-label="Line chart showing emails sent, opens, and replies over time"
                aria-describedby={descId}
            >
                {loading && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin" aria-hidden="true">
                                <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                                <path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                            </svg>
                            Loading chart data…
                        </div>
                    </div>
                )}
                {error && !loading && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                        <p className="text-xs text-red-400">{error}</p>
                        <button onClick={fetchStats} className="text-xs text-red-400 hover:underline focus-visible:outline-none rounded">Retry</button>
                    </div>
                )}
                {isEmpty && !loading && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <p className="text-xs text-[var(--text-muted)]">No send activity in this period.</p>
                    </div>
                )}
                {!error && !loading && !isEmpty && (
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                            <XAxis
                                dataKey="day"
                                tick={{ fill: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-body)" }}
                                axisLine={false}
                                tickLine={false}
                                interval="preserveStartEnd"
                            />
                            <YAxis
                                tick={{ fill: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-body)" }}
                                axisLine={false}
                                tickLine={false}
                                allowDecimals={false}
                                width={32}
                            />
                            <Tooltip content={<CustomTooltip />} cursor={{ stroke: "rgba(255,255,255,0.06)", strokeWidth: 1 }} />
                            <Line type="monotone" dataKey="sent" stroke="#e94560" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#e94560", strokeWidth: 0 }} />
                            <Line type="monotone" dataKey="opens" stroke="#38bdf8" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#38bdf8", strokeWidth: 0 }} />
                            <Line type="monotone" dataKey="replies" stroke="#4ade80" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#4ade80", strokeWidth: 0 }} />
                        </LineChart>
                    </ResponsiveContainer>
                )}
            </div>
        </div>
    );
}
