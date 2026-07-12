import type { DeliveryState } from "@/app/api/src/lib/message/messageHelper";

interface DeliveryTimelineProps {
    state: DeliveryState;
}

const DELIVERY_STATES: DeliveryState[] = [
    "DRAFT",
    "QUEUED",
    "SENT",
    "DELIVERED",
    "OPENED",
    "REPLIED",
];

export function DeliveryTimeline({ state }: DeliveryTimelineProps) {
    const isTerminal = ["BOUNCED", "FAILED", "SPAM"].includes(state);
    const activeIdx = isTerminal ? -1 : DELIVERY_STATES.indexOf(state);

    if (isTerminal) {
        const cfg = {
            BOUNCED: { label: "Bounced", color: "text-amber-500", bg: "bg-amber-400" },
            FAILED: { label: "Failed", color: "text-red-500", bg: "bg-red-500" },
            SPAM: { label: "Spam", color: "text-red-500", bg: "bg-red-500" },
        }[state as "BOUNCED" | "FAILED" | "SPAM"];

        return (
            <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${cfg.bg}`} />
                <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
            </div>
        );
    }

    return (
        <div className="flex items-center gap-0">
            {DELIVERY_STATES.map((s, i) => {
                const done = i < activeIdx;
                const current = i === activeIdx;
                return (
                    <div key={s} className="flex items-center">
                        <div
                            className="relative flex flex-col items-center"
                            title={s.charAt(0) + s.slice(1).toLowerCase()}
                        >
                            <div
                                className={[
                                    "w-2 h-2 rounded-full transition-all duration-300",
                                    done
                                        ? "bg-emerald-500"
                                        : current
                                            ? "bg-sky-400 ring-2 ring-sky-400/30"
                                            : "bg-slate-300 dark:bg-slate-600",
                                ].join(" ")}
                            />
                        </div>
                        {i < DELIVERY_STATES.length - 1 && (
                            <div
                                className={`w-5 h-px transition-colors duration-300 ${done ? "bg-emerald-500" : "bg-slate-200 dark:bg-slate-700"
                                    }`}
                            />
                        )}
                    </div>
                );
            })}
            <span className="ml-2 text-xs text-slate-500 capitalize">
                {state.charAt(0) + state.slice(1).toLowerCase()}
            </span>
        </div>
    );
}