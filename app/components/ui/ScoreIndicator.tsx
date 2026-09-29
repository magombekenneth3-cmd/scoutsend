"use client";

interface ScoreIndicatorProps {
    score: number;
    showLabel?: boolean;
}

export function ScoreIndicator({ score, showLabel = true }: ScoreIndicatorProps) {
    const displayScore = score <= 1 ? Math.round(score * 100) : Math.round(score);
    const color     = displayScore >= 85 ? "bg-emerald-400" : displayScore >= 65 ? "bg-amber-400" : "bg-[var(--red)]";
    const textColor = displayScore >= 85 ? "text-emerald-400" : displayScore >= 65 ? "text-amber-400" : "text-[var(--red-text)]";
    return (
        <div className="flex items-center gap-2">
            <div className="w-14 h-1.5 bg-[var(--surface-2)] rounded-full overflow-hidden flex-shrink-0">
                <div
                    className={`h-full rounded-full ${color} transition-all duration-500`}
                    style={{ width: `${displayScore}%` }}
                    role="progressbar"
                    aria-valuenow={displayScore}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Qualification score: ${displayScore}`}
                />
            </div>
            {showLabel && (
                <span className={`text-xs font-semibold tabular-nums ${textColor}`}>{displayScore}</span>
            )}
        </div>
    );
}
