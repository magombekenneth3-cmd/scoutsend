"use client";

interface StatCardProps {
    label: string;
    value: string | number;
    sub?: string;
    trend?: "up" | "down" | "neutral";
    trendValue?: string;
    icon: React.ReactNode;
    accent?: boolean;
}

export function StatCard({
    label,
    value,
    sub,
    trend,
    trendValue,
    icon,
    accent = false,
}: StatCardProps) {
    const trendColor =
        trend === "up"
            ? "text-emerald-400"
            : trend === "down"
                ? "text-red-400"
                : "text-[var(--text-secondary)]";

    const trendArrow = trend === "up" ? "↑" : trend === "down" ? "↓" : "→";

    const accessibleLabel = [
        label,
        String(value),
        sub,
        trendValue ? `${trendArrow} ${trendValue} vs last 7 days` : undefined,
    ].filter(Boolean).join(", ");

    return (
        <article
            aria-label={accessibleLabel}
            className={[
                "relative flex flex-col gap-3 rounded-xl p-5 border transition-all duration-200",
                "bg-[var(--surface)] border-[var(--border)]",
                "hover:border-[var(--border-red)] hover:shadow-[0_8px_32px_rgba(0,0,0,0.4)] hover:-translate-y-0.5",
                accent ? "ring-1 ring-[var(--red-glow)]" : "",
            ].join(" ")}

        >
            <div className="flex items-start justify-between" aria-hidden="true">
                <div
                    className={[
                        "flex items-center justify-center w-9 h-9 rounded-lg",
                        accent
                            ? "bg-[var(--red-glow)] text-[var(--red)]"
                            : "bg-[var(--surface-2)] text-[var(--text-secondary)]",
                    ].join(" ")}
                >
                    {icon}
                </div>

                {trendValue && (
                    <span
                        className={`text-xs font-medium tabular-nums ${trendColor} bg-[var(--surface-2)] px-2 py-1 rounded-full`}
                        aria-hidden="true"
                    >
                        {trendArrow} {trendValue}
                    </span>
                )}
            </div>

            <div aria-hidden="true">
                <p className="text-2xl font-bold text-[var(--text-primary)] font-display tabular-nums leading-none">
                    {value}
                </p>
                {sub && (
                    <p className="text-xs text-[var(--text-muted)] mt-1 tabular-nums">
                        {sub}
                    </p>
                )}
                {trendValue && (
                    <p className={`text-xs mt-1 tabular-nums ${trendColor}`}>
                        {trendArrow} {trendValue} vs last 7d
                    </p>
                )}
            </div>

            <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]" aria-hidden="true">
                {label}
            </p>

            {accent && (
                <div className="absolute bottom-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-[var(--red)] to-transparent opacity-60 rounded-full" aria-hidden="true" />
            )}
        </article>
    );
}