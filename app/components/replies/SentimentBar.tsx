interface SentimentBarProps {
    score: number | null;
}

export function SentimentBar({ score }: SentimentBarProps) {
    if (score === null) {
        return <span className="text-[var(--text-muted)] text-xs">—</span>;
    }

    const pct = Math.round(((score + 1) / 2) * 100);
    const barColor =
        score >= 0.3 ? "bg-emerald-400" : score <= -0.3 ? "bg-red-400" : "bg-amber-400";
    const textColor =
        score >= 0.3 ? "text-emerald-400" : score <= -0.3 ? "text-red-400" : "text-amber-400";

    return (
        <div className="flex items-center gap-2">
            <div className="w-16 h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden">
                <div
                    className={`h-full rounded-full ${barColor} transition-all duration-300`}
                    style={{ width: `${pct}%` }}
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Sentiment ${score > 0 ? "+" : ""}${score.toFixed(2)}`}
                />
            </div>
            <span className={`text-xs tabular-nums font-medium ${textColor}`}>
                {score > 0 ? "+" : ""}
                {score.toFixed(2)}
            </span>
        </div>
    );
}