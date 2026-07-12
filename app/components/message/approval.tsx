import type { ApprovalStatus } from "@/app/api/src/lib/message/messageHelper";

interface ApprovalBadgeProps {
    status: ApprovalStatus;
}

export function ApprovalBadge({ status }: ApprovalBadgeProps) {
    const cfg = {
        PENDING: {
            label: "Pending Review",
            dot: "bg-amber-400 animate-pulse",
            bg: "bg-amber-50 dark:bg-amber-900/20",
            text: "text-amber-600 dark:text-amber-400",
        },
        APPROVED: {
            label: "Approved",
            dot: "bg-emerald-500",
            bg: "bg-emerald-50 dark:bg-emerald-900/20",
            text: "text-emerald-700 dark:text-emerald-400",
        },
        REJECTED: {
            label: "Rejected",
            dot: "bg-red-500",
            bg: "bg-red-50 dark:bg-red-900/20",
            text: "text-red-600 dark:text-red-400",
        },
    }[status];

    return (
        <span
            className={`inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1 ${cfg.bg} ${cfg.text}`}
        >
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
            {cfg.label}
        </span>
    );
}