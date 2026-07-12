"use client";

import type { Suppression } from "@/app/api/src/lib/suppression/types";

function timeAgo(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

interface Props {
    item: Suppression;
    onDelete: (item: Suppression) => void;
    deleting: boolean;
}

export function SuppressionRow({ item, onDelete, deleting }: Props) {
    const isEmail = !!item.email;

    return (
        <tr className="border-b border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors duration-100 group">
            <td className="px-4 py-3">
                <div className="flex items-center gap-2.5">
                    <span
                        className={[
                            "flex-shrink-0 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded",
                            isEmail
                                ? "bg-blue-400/10 text-blue-400 border border-blue-400/20"
                                : "bg-violet-400/10 text-violet-400 border border-violet-400/20",
                        ].join(" ")}
                    >
                        {isEmail ? "Email" : "Domain"}
                    </span>
                    <span className="text-sm text-[var(--text-primary)] font-mono truncate max-w-[260px]">
                        {item.email ?? item.domain}
                    </span>
                </div>
            </td>

            <td className="px-4 py-3 max-w-[220px]">
                <span className="text-sm text-[var(--text-secondary)] line-clamp-1">{item.reason}</span>
            </td>

            <td className="px-4 py-3">
                {item.source ? (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-muted)]">
                        {item.source}
                    </span>
                ) : (
                    <span className="text-xs text-[var(--text-muted)]">—</span>
                )}
            </td>

            <td className="px-4 py-3">
                <span
                    className="text-xs text-[var(--text-muted)] tabular-nums"
                    title={new Date(item.createdAt).toLocaleString()}
                >
                    {timeAgo(item.createdAt)}
                </span>
            </td>

            <td className="px-4 py-3 text-right">
                <button
                    onClick={() => onDelete(item)}
                    disabled={deleting}
                    aria-label={`Remove ${item.email ?? item.domain}`}
                    className={[
                        "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                        "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium",
                        "text-[var(--text-muted)] hover:text-red-400 hover:bg-red-400/10 border border-transparent hover:border-red-400/20",
                        "transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]",
                        "disabled:opacity-30 disabled:cursor-not-allowed",
                    ].join(" ")}
                >
                    {deleting ? (
                        <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" strokeOpacity="0.2" />
                            <path d="M12 2a10 10 0 0 1 10 10" />
                        </svg>
                    ) : (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            <path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                        </svg>
                    )}
                    Remove
                </button>
            </td>
        </tr>
    );
}