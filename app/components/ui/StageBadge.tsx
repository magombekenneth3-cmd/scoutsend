import type { PipelineStage } from "./types";

const STAGE_STYLES: Record<PipelineStage | string, string> = {
    PROSPECT:       "bg-gray-50 text-gray-600 ring-1 ring-inset ring-gray-200",
    ENGAGED:        "bg-amber-50 text-amber-700",
    HOT:            "bg-orange-50 text-orange-700",
    MEETING_BOOKED: "bg-emerald-50 text-emerald-700",
    DISQUALIFIED:   "bg-gray-50 text-gray-400 ring-1 ring-inset ring-gray-200",
};

const STAGE_LABELS: Record<PipelineStage | string, string> = {
    PROSPECT:       "Prospect",
    ENGAGED:        "Contacted",
    HOT:            "Hot",
    MEETING_BOOKED: "Meeting booked",
    DISQUALIFIED:   "Disqualified",
};

const DEFAULT_STYLE = "bg-gray-50 text-gray-600 ring-1 ring-inset ring-gray-200";

interface StageBadgeProps {
    stage: string | null | undefined;
}

export function StageBadge({ stage }: StageBadgeProps) {
    const key = stage?.toUpperCase() ?? "PROSPECT";
    const className = STAGE_STYLES[key] ?? DEFAULT_STYLE;
    const label = STAGE_LABELS[key] ?? (stage ?? "Prospect");

    return (
        <span
            className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${className}`}
        >
            {label}
        </span>
    );
}
