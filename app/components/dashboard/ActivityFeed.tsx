"use client";

export type ActivityType =
    | "EMAIL_SENT"
    | "REPLY_RECEIVED"
    | "LEAD_RESEARCHED"
    | "MESSAGE_APPROVED"
    | "MESSAGE_REJECTED"
    | "CAMPAIGN_STARTED"
    | "CAMPAIGN_PAUSED"
    | "DOMAIN_WARNING"
    | "BOUNCE";

interface ActivityEvent {
    id: string;
    type: ActivityType;
    message: string;
    detail?: string;
    timestamp: string;
}

const ACTIVITY_CONFIG: Record<ActivityType, { icon: React.ReactNode; iconBg: string; iconText: string }> = {
    EMAIL_SENT: {
        icon: (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" />
            </svg>
        ),
        iconBg: "bg-sky-400/10",
        iconText: "text-sky-400",
    },
    REPLY_RECEIVED: {
        icon: (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 17 4 12 9 7" />
                <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
            </svg>
        ),
        iconBg: "bg-emerald-400/10",
        iconText: "text-emerald-400",
    },
    LEAD_RESEARCHED: {
        icon: (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
        ),
        iconBg: "bg-violet-400/10",
        iconText: "text-violet-400",
    },
    MESSAGE_APPROVED: {
        icon: (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
            </svg>
        ),
        iconBg: "bg-emerald-400/10",
        iconText: "text-emerald-400",
    },
    MESSAGE_REJECTED: {
        icon: (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
        ),
        iconBg: "bg-[var(--red-glow)]",
        iconText: "text-[var(--red)]",
    },
    CAMPAIGN_STARTED: {
        icon: (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
        ),
        iconBg: "bg-[var(--red-glow)]",
        iconText: "text-[var(--red)]",
    },
    CAMPAIGN_PAUSED: {
        icon: (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
        ),
        iconBg: "bg-amber-400/10",
        iconText: "text-amber-400",
    },
    DOMAIN_WARNING: {
        icon: (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
        ),
        iconBg: "bg-amber-400/10",
        iconText: "text-amber-400",
    },
    BOUNCE: {
        icon: (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
        ),
        iconBg: "bg-orange-400/10",
        iconText: "text-orange-400",
    },
};

export function ActivityItem({ event }: { event: ActivityEvent }) {
    const cfg = ACTIVITY_CONFIG[event.type];
    return (
        <li className="flex items-start gap-3 py-3 border-b border-[var(--border)] last:border-0">
            <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5 ${cfg.iconBg} ${cfg.iconText}`}>
                {cfg.icon}
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-sm text-[var(--text-primary)] leading-snug">{event.message}</p>
                {event.detail && (
                    <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">{event.detail}</p>
                )}
            </div>
            <time className="flex-shrink-0 text-xs text-[var(--text-muted)] tabular-nums">{event.timestamp}</time>
        </li>
    );
}

interface ActivityFeedProps {
    events: ActivityEvent[];
}

export function ActivityFeed({ events }: ActivityFeedProps) {
    if (events.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
                <div className="w-10 h-10 rounded-full bg-[var(--surface-2)] flex items-center justify-center text-[var(--text-muted)]">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                    </svg>
                </div>
                <p className="text-sm text-[var(--text-muted)]">No recent activity</p>
                <p className="text-xs text-[var(--text-muted)]">Events will appear as your campaigns run</p>
            </div>
        );
    }
    return (
        <ul role="list" className="divide-y divide-[var(--border)]">
            {events.map((event) => (
                <ActivityItem key={event.id} event={event} />
            ))}
        </ul>
    );
}