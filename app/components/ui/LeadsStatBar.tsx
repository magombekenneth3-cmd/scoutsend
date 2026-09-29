import type { LeadsSummary } from "./types";

export function LeadsStatBar({ showing, total, highPriority, avgScore, replied, replyRate }: LeadsSummary) {
    const stats: { label: string; value: number | null; suffix?: string }[] = [
        { label: "Showing",       value: showing,      suffix: `of ${total}` },
        { label: "High priority", value: highPriority                        },
        { label: "Avg score",     value: avgScore                            },
        { label: "Replied",       value: replied,      suffix: `${replyRate}%` },
    ];

    return (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.map((stat) => (
                <div key={stat.label} className="rounded-lg bg-gray-50 p-4">
                    <p className="text-sm text-gray-500">{stat.label}</p>
                    {stat.value === null ? (
                        <p className="mt-1 animate-pulse text-2xl font-semibold text-gray-300 motion-reduce:animate-none">
                            —
                        </p>
                    ) : (
                        <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">
                            {stat.value}
                            {stat.suffix && (
                                <span className="ml-1 text-sm font-normal text-gray-400">
                                    {stat.suffix}
                                </span>
                            )}
                        </p>
                    )}
                </div>
            ))}
        </div>
    );
}
