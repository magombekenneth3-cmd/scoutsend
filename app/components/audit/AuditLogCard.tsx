"use client";

import { useState } from "react";
import { AuditActionBadge } from "./AuditActionBadge";
import type { AuditLog } from "./AuditLogRow";

interface AuditLogCardProps {
    log: AuditLog;
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

export function AuditLogCard({ log }: AuditLogCardProps) {
    const [expanded, setExpanded] = useState(false);
    const hasMetadata = log.metadata && Object.keys(log.metadata).length > 0;

    const initials = `${log.user.firstName[0] ?? ""}${log.user.lastName[0] ?? ""}`.toUpperCase();

    return (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-3">
            {/* Header row */}
            <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[var(--red)] to-[var(--navy-deep)] flex-shrink-0 flex items-center justify-center text-xs font-bold text-white select-none">
                    {initials}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-[var(--text-primary)] truncate leading-none">
                            {log.user.firstName} {log.user.lastName}
                        </p>
                        <AuditActionBadge action={log.action} />
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">{log.user.email}</p>
                </div>
            </div>

            {/* Details row */}
            <div className="flex items-center justify-between text-xs gap-2 pt-1 border-t border-[var(--border)]">
                <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[var(--text-secondary)] truncate">
                        {log.entityType}
                    </span>
                    {log.entityId && log.entityId !== "unknown" && (
                        <>
                            <span className="text-[var(--text-muted)]">/</span>
                            <code className="text-[10px] font-mono text-[var(--text-muted)] truncate" title={log.entityId}>
                                {log.entityId.slice(-8)}
                            </code>
                        </>
                    )}
                </div>
                <span className="text-[var(--text-muted)] whitespace-nowrap tabular-nums flex-shrink-0">
                    {formatTimestamp(log.createdAt)}
                </span>
            </div>

            {/* Metadata toggle */}
            {hasMetadata && (
                <div>
                    <button
                        onClick={() => setExpanded((v) => !v)}
                        className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
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
                        {expanded ? "Hide" : "Show"} metadata
                    </button>

                    {expanded && (
                        <pre className="mt-2 text-[11px] font-mono text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto bg-[var(--surface-2)] rounded-lg p-3">
                            {JSON.stringify(log.metadata, null, 2)}
                        </pre>
                    )}
                </div>
            )}
        </div>
    );
}