interface ScoreGaugeProps {
    value: number | null | undefined;
    label: string;
    variant: "spam" | "personal";
}

export function ScoreGauge({ value, label, variant }: ScoreGaugeProps) {
    if (value == null) return null;
    const pct = Math.round(value * 100);
    const isSpam = variant === "spam";

    const isGood = isSpam ? pct < 20 : pct > 75;
    const isWarn = isSpam ? pct >= 20 && pct < 50 : pct <= 75 && pct > 40;

    const barBg = isGood
        ? "var(--success)"
        : isWarn
        ? "var(--warning)"
        : "var(--danger)";

    const textColor = isGood
        ? "var(--success-text)"
        : isWarn
        ? "var(--warning-text)"
        : "var(--danger-text)";

    return (
        <div className="flex flex-col gap-1.5 min-w-0">
            <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider font-semibold">
                    {label}
                </span>
                <span className="text-xs font-bold tabular-nums font-mono" style={{ color: textColor }}>
                    {pct}%
                </span>
            </div>
            <div className="h-1.5 bg-[var(--surface-2)] border border-[var(--border)] rounded-full overflow-hidden">
                <div
                    className="h-full rounded-full transition-all"
                    style={{
                        width: `${pct}%`,
                        backgroundColor: barBg,
                        transitionDuration: "250ms",
                        transitionTimingFunction: "var(--ease-smooth)",
                    }}
                />
            </div>
        </div>
    );
}