"use client";

import { useState, useEffect, useRef } from "react";
import { brandApi } from "@/app/api/brand/brand.api";

interface EmailPreviewProps {
    previewKey: number;
    configured: boolean;
}

export function EmailPreview({ previewKey, configured }: EmailPreviewProps) {
    const [html, setHtml] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<"desktop" | "mobile">("desktop");
    const iframeRef = useRef<HTMLIFrameElement>(null);

    useEffect(() => {
        if (!configured) return;
        setLoading(true);
        setError(null);
        brandApi
            .getPreviewHtml()
            .then((h) => setHtml(h))
            .catch((e) => setError(e.message))
            .finally(() => setLoading(false));
    }, [previewKey, configured]);

    const reload = () => {
        if (!configured) return;
        setLoading(true);
        setError(null);
        brandApi
            .getPreviewHtml()
            .then((h) => setHtml(h))
            .catch((e) => setError(e.message))
            .finally(() => setLoading(false));
    };

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border)] flex-shrink-0">
                <div>
                    <h2 className="text-sm font-semibold font-display text-[var(--text-primary)]">
                        Live Preview
                    </h2>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                        Renders exactly what recipients will see
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <div
                        className="flex rounded-lg border border-[var(--border)] overflow-hidden"
                        role="group"
                        aria-label="Preview viewport"
                    >
                        <button
                            onClick={() => setViewMode("desktop")}
                            aria-pressed={viewMode === "desktop"}
                            aria-label="Desktop preview"
                            className={[
                                "flex items-center justify-center w-8 h-7 transition-colors duration-150",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] focus-visible:ring-inset",
                                viewMode === "desktop"
                                    ? "bg-[var(--red-glow)] text-[var(--red)]"
                                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                            ].join(" ")}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <rect x="2" y="3" width="20" height="14" rx="2" />
                                <line x1="8" y1="21" x2="16" y2="21" />
                                <line x1="12" y1="17" x2="12" y2="21" />
                            </svg>
                        </button>
                        <button
                            onClick={() => setViewMode("mobile")}
                            aria-pressed={viewMode === "mobile"}
                            aria-label="Mobile preview"
                            className={[
                                "flex items-center justify-center w-8 h-7 transition-colors duration-150",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] focus-visible:ring-inset",
                                viewMode === "mobile"
                                    ? "bg-[var(--red-glow)] text-[var(--red)]"
                                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                            ].join(" ")}
                        >
                            <svg width="11" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <rect x="5" y="2" width="14" height="20" rx="2" />
                                <line x1="12" y1="18" x2="12.01" y2="18" />
                            </svg>
                        </button>
                    </div>

                    <button
                        onClick={reload}
                        disabled={!configured || loading}
                        aria-label="Reload preview"
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <svg
                            width="13" height="13" viewBox="0 0 24 24" fill="none"
                            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                            className={loading ? "animate-spin" : ""}
                            aria-hidden="true"
                        >
                            <polyline points="23 4 23 10 17 10" />
                            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                        </svg>
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-auto bg-[var(--background)] flex items-start justify-center p-6">
                {!configured ? (
                    <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
                        <div className="w-12 h-12 rounded-xl bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--text-muted)]" aria-hidden="true">
                                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                                <polyline points="22,6 12,13 2,6" />
                            </svg>
                        </div>
                        <p className="text-sm text-[var(--text-muted)] max-w-[200px] leading-relaxed">
                            Save your settings once to see the live email preview
                        </p>
                    </div>
                ) : loading && !html ? (
                    <div className="flex items-center justify-center h-full">
                        <div className="w-6 h-6 rounded-full border-2 border-[var(--border)] border-t-[var(--red)] animate-spin" aria-label="Loading preview" />
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3">
                        <p className="text-sm text-red-400">{error}</p>
                        <button
                            onClick={reload}
                            className="text-xs text-[var(--text-secondary)] underline hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] rounded"
                        >
                            Try again
                        </button>
                    </div>
                ) : html ? (
                    <div
                        className={[
                            "relative transition-all duration-300 ease-in-out",
                            viewMode === "mobile" ? "w-[375px]" : "w-full max-w-[640px]",
                        ].join(" ")}
                    >
                        {loading && (
                            <div className="absolute inset-0 flex items-center justify-center bg-[var(--background)]/80 z-10 rounded-xl">
                                <div className="w-5 h-5 rounded-full border-2 border-[var(--border)] border-t-[var(--red)] animate-spin" />
                            </div>
                        )}
                        <iframe
                            ref={iframeRef}
                            title="Email preview"
                            srcDoc={html}
                            className="w-full rounded-xl border border-[var(--border)] bg-white"
                            style={{ height: "620px" }}
                            sandbox="allow-same-origin"
                        />
                    </div>
                ) : null}
            </div>
        </div>
    );
}