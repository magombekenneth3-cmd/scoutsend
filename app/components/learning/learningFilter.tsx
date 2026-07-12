"use client";

import { type LearningEventType, type LearningOutcome } from "../../api/learning/learningApi";

const EVENT_TYPE_OPTIONS: { value: LearningEventType | ""; label: string }[] = [
    { value: "", label: "All Types" },
    { value: "REVIEW_FLAGGED", label: "Flagged" },
    { value: "HUMAN_EDITED", label: "Human Edited" },
    { value: "HUMAN_APPROVED", label: "Human Approved" },
    { value: "HUMAN_REJECTED", label: "Human Rejected" },
    { value: "AUTO_APPROVED", label: "Auto Approved" },
];

const OUTCOME_OPTIONS: { value: LearningOutcome | ""; label: string }[] = [
    { value: "", label: "All Outcomes" },
    { value: "PENDING_REVIEW", label: "Pending Review" },
    { value: "APPROVED", label: "Approved" },
    { value: "REJECTED", label: "Rejected" },
    { value: "EDITED_AND_APPROVED", label: "Edited & Approved" },
    { value: "DISMISSED", label: "Dismissed" },
];

interface LearningFiltersProps {
    eventType?: LearningEventType;
    outcome?: LearningOutcome;
    pendingOnly?: boolean;
    onEventTypeChange: (v: LearningEventType | undefined) => void;
    onOutcomeChange: (v: LearningOutcome | undefined) => void;
    onPendingOnlyChange: (v: boolean) => void;
    disabled?: boolean;
}

export function LearningFilters({
    eventType,
    outcome,
    pendingOnly,
    onEventTypeChange,
    onOutcomeChange,
    onPendingOnlyChange,
    disabled,
}: LearningFiltersProps) {
    const selectClass = [
        "h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm",
        "text-[var(--text-primary)] px-3 pr-8 appearance-none cursor-pointer",
        "focus:outline-none focus:ring-2 focus:ring-[var(--red)] focus:border-transparent",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        "bg-[image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238892b0' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E\")] bg-no-repeat bg-[right_10px_center]",
    ].join(" ");

    return (
        <div
            className="flex flex-wrap items-center gap-3"
            role="group"
            aria-label="Filter learning events"
        >
            <select
                value={eventType ?? ""}
                onChange={(e) =>
                    onEventTypeChange((e.target.value as LearningEventType) || undefined)
                }
                disabled={disabled}
                aria-label="Filter by event type"
                className={selectClass}
            >
                {EVENT_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                        {o.label}
                    </option>
                ))}
            </select>

            <select
                value={outcome ?? ""}
                onChange={(e) =>
                    onOutcomeChange((e.target.value as LearningOutcome) || undefined)
                }
                disabled={disabled || pendingOnly}
                aria-label="Filter by outcome"
                className={selectClass}
            >
                {OUTCOME_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                        {o.label}
                    </option>
                ))}
            </select>

            <label className="flex items-center gap-2 cursor-pointer select-none">
                <span className="relative inline-flex items-center">
                    <input
                        type="checkbox"
                        checked={!!pendingOnly}
                        onChange={(e) => onPendingOnlyChange(e.target.checked)}
                        disabled={disabled}
                        aria-label="Show pending only"
                        className="sr-only peer"
                    />
                    <span
                        className={[
                            "w-9 h-5 rounded-full border transition-colors duration-150",
                            "peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--red)] peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-[var(--navy-mid)]",
                            pendingOnly
                                ? "bg-[var(--red)] border-[var(--red)]"
                                : "bg-[var(--surface-2)] border-[var(--border)]",
                            "peer-disabled:opacity-50",
                        ].join(" ")}
                    />
                    <span
                        className={[
                            "absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-150",
                            pendingOnly ? "translate-x-4" : "translate-x-0",
                        ].join(" ")}
                        aria-hidden="true"
                    />
                </span>
                <span className="text-sm text-[var(--text-secondary)]">Pending only</span>
            </label>
        </div>
    );
}