"use client";

export type CampaignStatus =
    | "DRAFT"
    | "RESEARCHING"
    | "GENERATING"
    | "REVIEW"
    | "SENDING"
    | "PAUSED"
    | "FAILED"
    | "COMPLETED"
    | "QUEUED"
    | "CANCELED";

export type DomainHealth = "HEALTHY" | "DEGRADED" | "WARNING" | "CRITICAL";

const CAMPAIGN_CONFIG: Record<
    CampaignStatus,
    { label: string; dot: string; bg: string; text: string; pulse?: boolean }
> = {
    DRAFT: {
        label: "Draft",
        dot: "bg-[var(--text-muted)]",
        bg: "bg-[var(--surface-2)]",
        text: "text-[var(--text-secondary)]",
    },
    QUEUED: {
        label: "Queued",
        dot: "bg-[var(--text-secondary)]",
        bg: "bg-[var(--surface-2)]",
        text: "text-[var(--text-secondary)]",
        pulse: true,
    },
    RESEARCHING: {
        label: "Researching",
        dot: "bg-[var(--text-secondary)]",
        bg: "bg-[var(--surface-2)]",
        text: "text-[var(--text-secondary)]",
        pulse: true,
    },
    GENERATING: {
        label: "Generating",
        dot: "bg-[var(--red)]",
        bg: "bg-[var(--red-glow)]",
        text: "text-[var(--red-text)]",
        pulse: true,
    },
    REVIEW: {
        label: "Review",
        dot: "bg-[var(--warning)]",
        bg: "bg-[var(--warning-bg)]",
        text: "text-[var(--warning)]",
    },
    SENDING: {
        label: "Sending",
        dot: "bg-[var(--success)]",
        bg: "bg-[var(--success-bg)]",
        text: "text-[var(--success)]",
        pulse: true,
    },
    PAUSED: {
        label: "Paused",
        dot: "bg-[var(--text-muted)]",
        bg: "bg-[var(--surface-2)]",
        text: "text-[var(--text-secondary)]",
    },
    FAILED: {
        label: "Failed",
        dot: "bg-[var(--red)]",
        bg: "bg-[var(--red-glow)]",
        text: "text-[var(--red-text)]",
    },
    COMPLETED: {
        label: "Completed",
        dot: "bg-[var(--success)]",
        bg: "bg-[var(--success-bg)]",
        text: "text-[var(--success)]",
    },
    CANCELED: {
        label: "Canceled",
        dot: "bg-[var(--text-muted)]",
        bg: "bg-[var(--surface-2)]",
        text: "text-[var(--text-secondary)]",
    },
};

const DOMAIN_CONFIG: Record<
    DomainHealth,
    { label: string; dot: string; bg: string; text: string }
> = {
    HEALTHY: {
        label: "Healthy",
        dot: "bg-[var(--success)]",
        bg: "bg-[var(--success-bg)]",
        text: "text-[var(--success)]",
    },
    DEGRADED: {
        label: "Degraded",
        dot: "bg-[var(--warning)]",
        bg: "bg-[var(--warning-bg)]",
        text: "text-[var(--warning)]",
    },
    WARNING: {
        label: "Warning",
        dot: "bg-[var(--warning)]",
        bg: "bg-[var(--warning-bg)]",
        text: "text-[var(--warning)]",
    },
    CRITICAL: {
        label: "Critical",
        dot: "bg-[var(--red)]",
        bg: "bg-[var(--red-glow)]",
        text: "text-[var(--red-text)]",
    },
};

interface CampaignBadgeProps {
    status: CampaignStatus;
    size?: "sm" | "md";
}

export function CampaignBadge({ status, size = "md" }: CampaignBadgeProps) {
    const cfg = CAMPAIGN_CONFIG[status];
    return (
        <span
            className={[
                "inline-flex items-center gap-1.5 font-medium rounded-full",
                cfg.bg,
                cfg.text,
                size === "sm" ? "text-xs px-2 py-0.5" : "text-xs px-2.5 py-1",
            ].join(" ")}
        >
            <span
                className={[
                    "w-1.5 h-1.5 rounded-full flex-shrink-0",
                    cfg.dot,
                    cfg.pulse ? "animate-pulse" : "",
                ].join(" ")}
            />
            {cfg.label}
        </span>
    );
}

interface DomainBadgeProps {
    health: DomainHealth;
}

export function DomainBadge({ health }: DomainBadgeProps) {
    const cfg = DOMAIN_CONFIG[health];
    return (
        <span
            className={[
                "inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1",
                cfg.bg,
                cfg.text,
            ].join(" ")}
        >
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
            {cfg.label}
        </span>
    );
}