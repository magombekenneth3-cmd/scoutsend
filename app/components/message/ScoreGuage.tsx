interface ScoreGaugeProps {
    value: number | null | undefined;
    label: string;
    variant: "spam" | "personal";
}

export function ScoreGauge({ value, label, variant }: ScoreGaugeProps) {
    if (value == null) return null;
    const pct = Math.round(value * 100);
    const isSpam = variant === "spam";

    const barColor = isSpam
        ? pct < 20 ? "bg-emerald-400" : pct < 50 ? "bg-amber-400" : "bg-red-500"
        : pct > 75 ? "bg-emerald-400" : pct > 40 ? "bg-amber-400" : "bg-red-500";

    const textColor = isSpam
        ? pct < 20 ? "text-emerald-400" : pct < 50 ? "text-amber-400" : "text-red-500"
        : pct > 75 ? "text-emerald-400" : pct > 40 ? "text-amber-400" : "text-red-500";

    return (
        <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">
                    {label}
                </span>
                <span className={`text-xs font-bold tabular-nums ${textColor}`}>{pct}%</span>
            </div>
            <div className="h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <div
                    className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                    style={{ width: `${pct}%` }}
                />
            </div>
        </div>
    );
}