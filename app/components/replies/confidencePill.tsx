interface ConfidencePillProps {
    confidence: number | null;
}

export function ConfidencePill({ confidence }: ConfidencePillProps) {
    if (confidence === null) return null;

    const pct = Math.round(confidence * 100);
    const colorClass =
        pct >= 80
            ? "text-emerald-400 bg-emerald-400/10"
            : pct >= 50
                ? "text-amber-400 bg-amber-400/10"
                : "text-[var(--text-muted)] bg-[var(--surface-2)]";

    return (
        <span
            className={`text-xs font-medium px-1.5 py-0.5 rounded tabular-nums ${colorClass}`}
            aria-label={`Confidence ${pct}%`}
        >
            {pct}%
        </span>
    );
}