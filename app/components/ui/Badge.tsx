"use client";

export type SignalType =
    | "HIRING" | "HIRING_SIGNAL"
    | "FUNDING" | "FUNDING_SIGNAL"
    | "EXPANSION" | "GROWTH_SIGNAL" | "INTENT_SIGNAL"
    | "TECH_SIGNAL"
    | "PRODUCT_LAUNCH"
    | "WEBSITE_COPY"
    | "CONTENT"
    | string;

export type ActionKey = "HIGH_PRIORITY" | "STANDARD" | "NURTURE" | "DISQUALIFY";
export type PipelineKey = "PROSPECT" | "QUALIFIED" | "OUTREACH" | "ENGAGED" | "HOT" | "MEETING_BOOKED" | "DISQUALIFIED";
export type EmailStatusKey = "VERIFIED" | "DELIVERED" | "BOUNCED" | "NOT_ATTEMPTED";

const SIGNAL_COLORS: Record<string, { bg: string; text: string }> = {
    HIRING:         { bg: "bg-[var(--signal-hiring-bg)]",  text: "text-[var(--signal-hiring-text)] border border-[var(--signal-hiring-border)]" },
    HIRING_SIGNAL:  { bg: "bg-[var(--signal-hiring-bg)]",  text: "text-[var(--signal-hiring-text)] border border-[var(--signal-hiring-border)]" },
    FUNDING:        { bg: "bg-[var(--signal-funding-bg)]", text: "text-[var(--signal-funding-text)] border border-[var(--signal-funding-border)]" },
    FUNDING_SIGNAL: { bg: "bg-[var(--signal-funding-bg)]", text: "text-[var(--signal-funding-text)] border border-[var(--signal-funding-border)]" },
    EXPANSION:      { bg: "bg-[var(--signal-growth-bg)]",  text: "text-[var(--signal-growth-text)] border border-[var(--signal-growth-border)]" },
    GROWTH_SIGNAL:  { bg: "bg-[var(--signal-growth-bg)]",  text: "text-[var(--signal-growth-text)] border border-[var(--signal-growth-border)]" },
    INTENT_SIGNAL:  { bg: "bg-[var(--signal-intent-bg)]",  text: "text-[var(--signal-intent-text)] border border-[var(--signal-intent-border)]" },
    TECH_SIGNAL:    { bg: "bg-[var(--signal-tech-bg)]",    text: "text-[var(--signal-tech-text)] border border-[var(--signal-tech-border)]" },
    PRODUCT_LAUNCH: { bg: "bg-[var(--signal-growth-bg)]",  text: "text-[var(--signal-growth-text)] border border-[var(--signal-growth-border)]" },
    WEBSITE_COPY:   { bg: "bg-[var(--surface-2)]",          text: "text-[var(--text-secondary)] border border-[var(--border)]" },
    CONTENT:        { bg: "bg-[var(--surface-2)]",          text: "text-[var(--text-secondary)] border border-[var(--border)]" },
};

const ACTION_MAP: Record<ActionKey, { label: string; className: string; icon: React.ReactNode }> = {
    HIGH_PRIORITY: {
        label: "High Priority",
        className: "bg-[var(--red-glow)] text-[var(--red-text)] border border-[var(--border-red)]",
        icon: (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
        ),
    },
    STANDARD: {
        label: "Standard",
        className: "bg-[var(--surface-2)] text-[var(--text-secondary)] border border-[var(--border)]",
        icon: (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <circle cx="12" cy="12" r="4" />
            </svg>
        ),
    },
    NURTURE: {
        label: "Nurture",
        className: "bg-[var(--surface-2)] text-[var(--text-secondary)] border border-[var(--border)]",
        icon: (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
        ),
    },
    DISQUALIFY: {
        label: "Disqualify",
        className: "bg-[var(--surface-2)] text-[var(--text-muted)] border border-[var(--border)]",
        icon: (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
        ),
    },
};

const PIPELINE_MAP: Record<string, { label: string; className: string }> = {
    PROSPECT:       { label: "Prospect",       className: "bg-[var(--surface-2)] text-[var(--text-secondary)] border border-[var(--border)]" },
    QUALIFIED:      { label: "Qualified",      className: "bg-[var(--surface-2)] text-[var(--text-secondary)] border border-[var(--border)]" },
    OUTREACH:       { label: "Outreach",       className: "bg-[var(--surface-2)] text-[var(--text-secondary)] border border-[var(--border)]" },
    ENGAGED:        { label: "Engaged",        className: "bg-[var(--success-bg)] text-[var(--success)] border border-[var(--success-border)]" },
    HOT:            { label: "Hot",            className: "bg-[var(--success-bg)] text-[var(--success)] border border-[var(--success-border)]" },
    MEETING_BOOKED: { label: "Meeting Booked", className: "bg-[var(--success-bg)] text-[var(--success)] border border-[var(--success-border)]" },
    DISQUALIFIED:   { label: "Disqualified",   className: "bg-[var(--surface-2)] text-[var(--text-muted)] border border-[var(--border)]" },
};

const EMAIL_STATUS_MAP: Record<EmailStatusKey, { label: string; icon: string; className: string }> = {
    VERIFIED:      { label: "Verified",   icon: "✓", className: "bg-[var(--success-bg)] text-[var(--success)] border-[var(--success-border)]" },
    DELIVERED:     { label: "Delivered",  icon: "✓", className: "bg-[var(--success-bg)] text-[var(--success)] border-[var(--success-border)]" },
    BOUNCED:       { label: "Bounced",    icon: "✕", className: "bg-[var(--danger-bg)] text-[var(--danger)] border-[var(--danger-border)]" },
    NOT_ATTEMPTED: { label: "Unverified", icon: "?", className: "bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]" },
};


interface SignalBadgeProps {
    type?: string;
    signalType?: string;
    value?: string;
}

export function SignalBadge({ type, signalType, value }: SignalBadgeProps) {
    const rawType = signalType ?? type ?? "CONTENT";
    const cfg = SIGNAL_COLORS[rawType] ?? SIGNAL_COLORS.CONTENT;
    const label = rawType.replace(/_SIGNAL$/, "").replace(/_/g, " ");
    return (
        <span
            className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}
            title={value}
        >
            <span className="w-1 h-1 rounded-full bg-current opacity-70 flex-shrink-0" aria-hidden="true" />
            {label}
        </span>
    );
}

interface ActionBadgeProps {
    action: ActionKey | string | null;
}

export function ActionBadge({ action }: ActionBadgeProps) {
    if (!action) return null;
    const cfg = ACTION_MAP[action as ActionKey];
    if (!cfg) return null;
    return (
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${cfg.className}`}>
            {cfg.icon}
            {cfg.label}
        </span>
    );
}

interface PipelinePillProps {
    stage: PipelineKey | string | null;
}

export function PipelinePill({ stage }: PipelinePillProps) {
    if (!stage) return null;
    const cfg = PIPELINE_MAP[stage];
    if (!cfg) return null;
    return (
        <span className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full border ${cfg.className}`}>
            {cfg.label}
        </span>
    );
}

interface EmailStatusBadgeProps {
    status: EmailStatusKey | string | null;
}

export function EmailStatusBadge({ status }: EmailStatusBadgeProps) {
    if (!status) return null;
    const cfg = EMAIL_STATUS_MAP[status as EmailStatusKey];
    if (!cfg) return null;
    return (
        <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${cfg.className}`}>
            <span className="font-bold">{cfg.icon}</span> {cfg.label}
        </span>
    );
}

interface CompetitorBadgeProps {
    tech: string[];
}

export function CompetitorBadge({ tech }: CompetitorBadgeProps) {
    const label =
        tech.length > 0
            ? tech.slice(0, 2).map((t) => t.replace(/_/g, " ")).join(", ") +
              (tech.length > 2 ? ` +${tech.length - 2}` : "")
            : "Competitor user";
    return (
        <span
            className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--warning-bg)] text-[var(--warning)] border border-[var(--warning-border)] uppercase tracking-wider whitespace-nowrap"
            title={`Uses competing tech: ${tech.join(", ") || "unknown"}`}
        >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15v-4H7l5-8v4h4l-5 8z" />
            </svg>
            {label}
        </span>
    );
}
