interface SentimentBarProps {
    score: number | null;
}

export function SentimentBar({ score }: SentimentBarProps) {
    if (score === null) {
        return <span className="text-[var(--text-muted)] text-xs">—</span>;
    }

    const pct = Math.round(((score + 1) / 2) * 100);
    const barBg =
        score >= 0.3 ? "var(--success)" : score <= -0.3 ? "var(--danger)" : "var(--warning)";
    const textColor =
        score >= 0.3 ? "var(--success-text)" : score <= -0.3 ? "var(--danger-text)" : "var(--warning-text)";

    return (
        <div className="flex items-center gap-2">
            <div className="w-16 h-1.5 rounded-full bg-[var(--surface-2)] border border-[var(--border)] overflow-hidden">
                <div
                    className="h-full rounded-full transition-all"
                    style={{
                        width: `${pct}%`,
                        backgroundColor: barBg,
                        transitionDuration: "250ms",
                        transitionTimingFunction: "var(--ease-smooth)",
                    }}
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Sentiment ${score > 0 ? "+" : ""}${score.toFixed(2)}`}
                />
            </div>
            <span className="text-xs tabular-nums font-mono font-bold" style={{ color: textColor }}>
                {score > 0 ? "+" : ""}
                {score.toFixed(2)}
            </span>
        </div>
    );
}