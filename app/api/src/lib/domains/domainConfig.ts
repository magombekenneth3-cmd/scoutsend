import { DomainHealth } from "./domain.type";


export interface HealthConfig {
    label: string;
    dot: string;
    badge: string;
    ring: string;
    bg: string;
    text: string;
    bar: string;
}

export const HEALTH_CONFIG: Record<DomainHealth, HealthConfig> = {
    HEALTHY: {
        label: "Healthy",
        dot: "bg-emerald-400",
        badge: "bg-emerald-400/10 border border-emerald-400/20 text-emerald-400",
        ring: "border-emerald-400/40",
        bg: "bg-emerald-400/5",
        text: "text-emerald-400",
        bar: "bg-emerald-400",
    },
    WARNING: {
        label: "Warning",
        dot: "bg-amber-400",
        badge: "bg-amber-400/10 border border-amber-400/20 text-amber-400",
        ring: "border-amber-400/40",
        bg: "bg-amber-400/5",
        text: "text-amber-400",
        bar: "bg-amber-400",
    },
    DEGRADED: {
        label: "Degraded",
        dot: "bg-orange-400",
        badge: "bg-orange-400/10 border border-orange-400/20 text-orange-400",
        ring: "border-orange-400/40",
        bg: "bg-orange-400/5",
        text: "text-orange-400",
        bar: "bg-orange-400",
    },
    BLOCKED: {
        label: "Blocked",
        dot: "bg-red-500",
        badge: "bg-red-500/10 border border-red-500/20 text-red-400",
        ring: "border-red-500/40",
        bg: "bg-red-500/5",
        text: "text-red-400",
        bar: "bg-red-500",
    },
};

export const SEVERITY_CONFIG: Record<string, { text: string; bg: string }> = {
    LOW: { text: "text-[var(--text-muted)]", bg: "bg-[var(--surface-2)]" },
    MEDIUM: { text: "text-amber-400", bg: "bg-amber-400/10" },
    HIGH: { text: "text-orange-400", bg: "bg-orange-400/10" },
    CRITICAL: { text: "text-red-400", bg: "bg-red-400/10" },
};