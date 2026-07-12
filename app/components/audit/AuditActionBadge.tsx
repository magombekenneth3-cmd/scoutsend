"use client";



type BadgeConfig = {
    label: string;
    className: string;
};

const ACTION_MAP: Record<string, BadgeConfig> = {
    USER_REGISTERED: { label: "Registered", className: "text-sky-400 bg-sky-400/10 border-sky-400/20" },
    USER_LOGIN: { label: "Login", className: "text-sky-400 bg-sky-400/10 border-sky-400/20" },
    USER_LOGIN_FAILED: { label: "Login Failed", className: "text-rose-400 bg-rose-400/10 border-rose-400/20" },
    USER_LOGOUT: { label: "Logout", className: "text-sky-300 bg-sky-300/10 border-sky-300/20" },
    PASSWORD_RESET: { label: "Pwd Reset", className: "text-sky-400 bg-sky-400/10 border-sky-400/20" },
    LEAD_CREATED: { label: "Lead Created", className: "text-violet-400 bg-violet-400/10 border-violet-400/20" },
    LEAD_UPDATED: { label: "Lead Updated", className: "text-violet-400 bg-violet-400/10 border-violet-400/20" },
    LEAD_DELETED: { label: "Lead Deleted", className: "text-violet-400 bg-violet-400/10 border-violet-400/20" },
    LEADS_BULK_IMPORTED: { label: "Bulk Import", className: "text-violet-300 bg-violet-300/10 border-violet-300/20" },
    LEAD_PIPELINE_ADVANCED: { label: "Pipeline ↑", className: "text-violet-300 bg-violet-300/10 border-violet-300/20" },
    CAMPAIGN_CREATED: { label: "Camp. Created", className: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" },
    CAMPAIGN_UPDATED: { label: "Camp. Updated", className: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" },
    CAMPAIGN_STARTED: { label: "Camp. Started", className: "text-emerald-300 bg-emerald-300/10 border-emerald-300/20" },
    CAMPAIGN_PAUSED: { label: "Camp. Paused", className: "text-amber-400 bg-amber-400/10 border-amber-400/20" },
    CAMPAIGN_COMPLETED: { label: "Camp. Done", className: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" },
    CAMPAIGN_DELETED: { label: "Camp. Deleted", className: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" },


    EMAIL_SENT: { label: "Email Sent", className: "text-teal-400 bg-teal-400/10 border-teal-400/20" },
    EMAIL_FAILED: { label: "Email Failed", className: "text-rose-400 bg-rose-400/10 border-rose-400/20" },
    REPLY_RECEIVED: { label: "Reply In", className: "text-indigo-400 bg-indigo-400/10 border-indigo-400/20" },
    REPLY_DRAFT_SENT: { label: "Draft Sent", className: "text-indigo-400 bg-indigo-400/10 border-indigo-400/20" },
    REPLY_REVIEWED: { label: "Reviewed", className: "text-indigo-300 bg-indigo-300/10 border-indigo-300/20" },
    REPLY_MEETING_LINK_INJECTED: { label: "Mtg Link", className: "text-indigo-300 bg-indigo-300/10 border-indigo-300/20" },
    REPLY_OBJECTION_HANDLED: { label: "Objection", className: "text-indigo-400 bg-indigo-400/10 border-indigo-400/20" },
    MESSAGE_APPROVED: { label: "Approved", className: "text-[var(--red)] bg-[var(--red-glow)] border-[var(--border-red)]" },
    MESSAGE_REJECTED: { label: "Rejected", className: "text-[var(--red)] bg-[var(--red-glow)] border-[var(--border-red)]" },
    QUEUE_JOB_FAILED: { label: "Job Failed", className: "text-orange-400 bg-orange-400/10 border-orange-400/20" },
    QUEUE_JOB_COMPLETED: { label: "Job Done", className: "text-orange-300 bg-orange-300/10 border-orange-300/20" },
    API_KEY_CREATED: { label: "Key Created", className: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20" },
    API_KEY_REVOKED: { label: "Key Revoked", className: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20" },
    UNAUTHORIZED_ACCESS: { label: "Unauthorized", className: "text-[var(--red)] bg-[var(--red-glow)] border-[var(--border-red)]" },
    LEARNING_EVENT_RESOLVED: { label: "Resolved", className: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" },
    LEARNING_EVENT_DISMISSED: { label: "Dismissed", className: "text-emerald-300 bg-emerald-300/10 border-emerald-300/20" },
    DELIVERABILITY_EVENT_CREATED: { label: "Deliverability", className: "text-teal-400 bg-teal-400/10 border-teal-400/20" },
    DOMAIN_HEALTH_UPDATED: { label: "Domain Health", className: "text-teal-300 bg-teal-300/10 border-teal-300/20" },
    DOMAIN_ADDED: { label: "Domain Added", className: "text-teal-400 bg-teal-400/10 border-teal-400/20" },
    DOMAIN_REMOVED: { label: "Domain Removed", className: "text-teal-400 bg-teal-400/10 border-teal-400/20" },
    BRAND_SETTINGS_UPDATED: { label: "Brand Update", className: "text-pink-400 bg-pink-400/10 border-pink-400/20" },
    SUPPRESSION_ADDED: { label: "Suppressed", className: "text-amber-400 bg-amber-400/10 border-amber-400/20" },
    SUPPRESSION_REMOVED: { label: "Unsuppressed", className: "text-amber-300 bg-amber-300/10 border-amber-300/20" },
};

const FALLBACK: BadgeConfig = {
    label: "Event",
    className: "text-[var(--text-secondary)] bg-[var(--surface-2)] border-[var(--border)]",
};

interface AuditActionBadgeProps {
    action: string;
}

export function AuditActionBadge({ action }: AuditActionBadgeProps) {
    const config = ACTION_MAP[action] ?? FALLBACK;
    const label = config.label;

    return (
        <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold tracking-wide border ${config.className}`}
            title={action}
        >
            {label}
        </span>
    );
}


export const AUDIT_ACTION_KEYS = Object.keys(ACTION_MAP);
export { ACTION_MAP };