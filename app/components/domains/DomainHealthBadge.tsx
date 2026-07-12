import { DomainHealth } from "@/app/api/src/lib/domains/domain.type";
import { HEALTH_CONFIG } from "@/app/api/src/lib/domains/domainConfig";

interface DomainHealthBadgeProps {
    health: DomainHealth;
    size?: "sm" | "md";
}

export function DomainHealthBadge({ health, size = "md" }: DomainHealthBadgeProps) {
    const cfg = HEALTH_CONFIG[health];
    return (
        <span
            className={[
                "inline-flex items-center gap-1.5 font-semibold rounded-full",
                cfg.badge,
                size === "sm" ? "text-[10px] px-1.5 py-px" : "text-xs px-2.5 py-1",
            ].join(" ")}
        >
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} aria-hidden="true" />
            {cfg.label}
        </span>
    );
}