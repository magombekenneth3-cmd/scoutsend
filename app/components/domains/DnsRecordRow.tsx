"use client";

import { useState } from "react";

type RecordStatus = boolean | null;

interface DnsRecordRowProps {
    label: string;
    type: "TXT" | "CNAME";
    host: string;
    value: string;
    status: RecordStatus;
    helpText?: string;
}

export function DnsRecordRow({ label, type, host, value, status, helpText }: DnsRecordRowProps) {
    const [copied, setCopied] = useState(false);

    function copyValue() {
        if (typeof navigator !== "undefined" && navigator.clipboard) {
            navigator.clipboard.writeText(value).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
            }).catch(() => {});
        }
    }

    const isGenerating = value === "Generating…";

    return (
        <div className="rounded-lg bg-[var(--surface)] border border-[var(--border)] p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[var(--text-primary)]">{label}</span>
                    <span className="text-[10px] font-bold px-1.5 py-px rounded bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-muted)] tracking-wide">
                        {type}
                    </span>
                </div>
                {status === null ? (
                    <span className="text-[10px] font-medium text-[var(--text-muted)] bg-[var(--surface-2)] border border-[var(--border)] rounded px-1.5 py-px">
                        Not checked
                    </span>
                ) : status ? (
                    <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded px-1.5 py-px">
                        ✓ Valid
                    </span>
                ) : (
                    <span className="text-[10px] font-semibold text-red-400 bg-red-400/10 border border-red-400/20 rounded px-1.5 py-px">
                        ✗ Missing
                    </span>
                )}
            </div>

            <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)] w-8 flex-shrink-0">Host</span>
                    <code className="flex-1 text-[11px] font-mono text-[var(--text-secondary)] bg-[var(--surface-2)] rounded px-2 py-1 truncate">
                        {host}
                    </code>
                </div>
                <div className="flex items-start gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)] w-8 flex-shrink-0 mt-1">Value</span>
                    <div className="flex-1 min-w-0 relative group/copy">
                        <code
                            className={[
                                "block text-[11px] font-mono text-[var(--text-secondary)] bg-[var(--surface-2)] rounded px-2 py-1 break-all leading-relaxed",
                                isGenerating ? "italic text-[var(--text-muted)]" : "",
                            ].join(" ")}
                        >
                            {value}
                        </code>
                        {!isGenerating && (
                            <button
                                onClick={copyValue}
                                aria-label="Copy value"
                                className="absolute top-1 right-1 opacity-0 group-hover/copy:opacity-100 transition-opacity w-6 h-6 flex items-center justify-center rounded bg-[var(--surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                            >
                                {copied ? (
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-emerald-400">
                                        <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                ) : (
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                        <rect x="9" y="9" width="13" height="13" rx="2" />
                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                    </svg>
                                )}
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {helpText && (
                <p className="text-[11px] text-[var(--text-muted)] leading-relaxed border-t border-[var(--border)] pt-2">
                    {helpText}
                </p>
            )}
        </div>
    );
}
