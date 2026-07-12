"use client";

import { useState, useEffect } from "react";
import { fetchTraceById } from "@/app/api/ai-traces/aitraceapi";
import type { AITrace, AITraceDetail } from "@/app/api/ai-traces/types";
import { confidenceColor, formatMs, formatTokens, latencyColor, timeAgo } from "@/app/api/ai-traces/utils";

interface AITraceDetailPanelProps {
    trace: AITrace;
    onClose: () => void;
}

function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);
    async function handleCopy() {
        await navigator.clipboard.writeText(text).catch(() => { });
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
    }
    return (
        <button
            onClick={handleCopy}
            aria-label="Copy to clipboard"
            className="flex items-center gap-1 text-[10px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--red)] rounded px-1"
        >
            {copied ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-emerald-400"><polyline points="20 6 9 17 4 12" /></svg>
            ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            )}
            {copied ? "Copied" : "Copy"}
        </button>
    );
}

interface TextBlockProps {
    label: string;
    content: string;
    mono?: boolean;
}

function TextBlock({ label, content, mono }: TextBlockProps) {
    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">{label}</p>
                <CopyButton text={content} />
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--navy-mid)] p-3 max-h-48 overflow-y-auto">
                <p className={`text-xs text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap break-words ${mono ? "font-mono" : ""}`}>
                    {content}
                </p>
            </div>
        </div>
    );
}

export function AITraceDetailPanel({ trace, onClose }: AITraceDetailPanelProps) {
    const [detail, setDetail] = useState<AITraceDetail | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setDetail(null);
        setLoading(true);
        fetchTraceById(trace.id)
            .then(setDetail)
            .catch(() => setDetail(null))
            .finally(() => setLoading(false));
    }, [trace.id]);

    const confColor = confidenceColor(trace.confidence);
    const latColor = latencyColor(trace.latencyMs);

    return (
        <div className="flex flex-col h-full bg-[var(--surface)] border-l border-[var(--border)] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] flex-shrink-0">
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{trace.agentName}</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5 font-mono">{trace.id}</p>
                </div>
                <button
                    onClick={onClose}
                    aria-label="Close detail panel"
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                <div className="grid grid-cols-2 gap-3">
                    {[
                        {
                            label: "Model",
                            node: <span className="text-xs font-mono text-[var(--text-primary)] bg-[var(--surface)] px-2 py-0.5 rounded border border-[var(--border)]">{trace.model}</span>,
                        },
                        {
                            label: "Latency",
                            node: <span className={`text-sm font-bold tabular-nums ${latColor}`}>{formatMs(trace.latencyMs)}</span>,
                        },
                        {
                            label: "Tokens",
                            node: <span className="text-sm font-bold text-[var(--text-primary)] tabular-nums">{formatTokens(trace.tokenUsage)}</span>,
                        },
                        {
                            label: "Confidence",
                            node: trace.confidence !== null
                                ? <span className={`text-sm font-bold tabular-nums ${confColor}`}>{Math.round(trace.confidence * 100)}%</span>
                                : <span className="text-sm text-[var(--text-muted)]">—</span>,
                        },
                    ].map(({ label, node }) => (
                        <div key={label} className="bg-[var(--surface-2)] border border-[var(--border)] rounded-lg p-3">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1.5">{label}</p>
                            {node}
                        </div>
                    ))}
                </div>

                <p className="text-xs text-[var(--text-muted)]">
                    {timeAgo(trace.createdAt)} · {new Date(trace.createdAt).toLocaleString()}
                </p>

                {trace.metadata && Object.keys(trace.metadata).length > 0 && (
                    <div className="space-y-1.5">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Metadata</p>
                        <div className="rounded-lg border border-[var(--border)] bg-[var(--navy-mid)] p-3">
                            <pre className="text-[11px] font-mono text-[var(--text-secondary)] overflow-x-auto whitespace-pre-wrap break-all">
                                {JSON.stringify(trace.metadata, null, 2)}
                            </pre>
                        </div>
                    </div>
                )}

                {loading && (
                    <div className="space-y-3">
                        {[60, 40, 80].map((w, i) => (
                            <div key={i} className="space-y-1.5">
                                <div className={`h-2.5 w-${w === 60 ? "16" : w === 40 ? "12" : "20"} rounded bg-[var(--surface-2)] animate-pulse`} />
                                <div className="h-24 rounded-lg bg-[var(--surface-2)] animate-pulse" />
                            </div>
                        ))}
                    </div>
                )}

                {!loading && detail && (
                    <>
                        <TextBlock label="Prompt" content={detail.prompt} />
                        <TextBlock label="Response" content={detail.response} mono />
                    </>
                )}

                {!loading && !detail && (
                    <p className="text-xs text-[var(--text-muted)] text-center py-4">Could not load prompt/response content.</p>
                )}
            </div>
        </div>
    );
}