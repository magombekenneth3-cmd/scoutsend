"use client";

import { AuditActionBadge } from "./AuditActionBadge";

export interface AuditLog {
    id: string;
    action: string;
    entityType: string;
    entityId: string;
    metadata: Record<string, unknown> | null;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: string;
    user: {
        id: string;
        firstName: string;
        lastName: string;
        email: string;
    };
}

interface AuditLogRowProps {
    log: AuditLog;
    onExpand: (log: AuditLog) => void;
    expanded: boolean;
}

function formatTimestamp(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
    });
}

function UserCell({ user }: { user: AuditLog["user"] }) {
    const initials = `${user.firstName[0] ?? ""}${user.lastName[0] ?? ""}`.toUpperCase();
    return (
        <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[var(--red)] to-[var(--navy-deep)] flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white select-none">
                {initials}
            </div>
            <div className="min-w-0">
                <p className="text-xs font-medium text-[var(--text-primary)] truncate leading-none">
                    {user.firstName} {user.lastName}
                </p>
                <p className="text-[10px] text-[var(--text-muted)] truncate mt-0.5">{user.email}</p>
            </div>
        </div>
    );
}

export function AuditLogRow({ log, onExpand, expanded }: AuditLogRowProps) {
    const hasMetadata = log.metadata && Object.keys(log.metadata).length > 0;

    return (
        <>
            <tr
                className="border-b border-[var(--border)] hover:bg-[var(--surface-2)]/40 transition-colors cursor-pointer group"
                onClick={() => onExpand(log)}
            >
                {/* Timestamp */}
                <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-xs text-[var(--text-muted)] tabular-nums">
                        {formatTimestamp(log.createdAt)}
                    </span>
                </td>

                {/* Action badge */}
                <td className="px-4 py-3 whitespace-nowrap">
                    <AuditActionBadge action={log.action} />
                </td>

                {/* User */}
                <td className="px-4 py-3 max-w-[180px]">
                    <UserCell user={log.user} />
                </td>

                {/* Entity */}
                <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                        <span className="text-xs text-[var(--text-secondary)]">
                            {log.entityType}
                        </span>
                        {log.entityId && log.entityId !== "unknown" && (
                            <>
                                <span className="text-[var(--text-muted)]">/</span>
                                <code className="text-[10px] font-mono text-[var(--text-muted)] truncate max-w-[80px]" title={log.entityId}>
                                    {log.entityId.slice(-8)}
                                </code>
                            </>
                        )}
                    </div>
                </td>

                {/* IP */}
                <td className="px-4 py-3 hidden lg:table-cell">
                    <span className="text-xs font-mono text-[var(--text-muted)]">
                        {log.ipAddress ?? "—"}
                    </span>
                </td>

                {/* Expand toggle */}
                <td className="px-4 py-3 text-right">
                    {hasMetadata && (
                        <button
                            aria-label={expanded ? "Collapse metadata" : "Expand metadata"}
                            className="inline-flex items-center gap-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors opacity-0 group-hover:opacity-100"
                            onClick={(e) => { e.stopPropagation(); onExpand(log); }}
                        >
                            <svg
                                width="10"
                                height="10"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                className={`transition-transform ${expanded ? "rotate-180" : ""}`}
                            >
                                <polyline points="6 9 12 15 18 9" />
                            </svg>
                            meta
                        </button>
                    )}
                </td>
            </tr>

            {/* Expanded metadata row */}
            {expanded && hasMetadata && (
                <tr className="border-b border-[var(--border)] bg-[var(--surface-2)]/30">
                    <td colSpan={6} className="px-4 py-3">
                        <pre className="text-[11px] font-mono text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto">
                            {JSON.stringify(log.metadata, null, 2)}
                        </pre>
                    </td>
                </tr>
            )}
        </>
    );
}