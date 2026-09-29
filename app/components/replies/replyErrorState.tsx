"use client";

import { useState, useEffect } from "react";
import { ApiError } from "@/app/api/replies/replyApi";

interface RepliesErrorBannerProps {
    error: ApiError;
    onRetry: () => void;
    isRetrying?: boolean;
}

export function RepliesErrorBanner({ error, onRetry, isRetrying }: RepliesErrorBannerProps) {
    const [countdown, setCountdown] = useState<number | null>(
        error.kind === "RATE_LIMITED" ? (error.retryAfterSeconds ?? null) : null
    );

    useEffect(() => {
        if (countdown === null || countdown <= 0) return;
        const t = setInterval(() => {
            setCountdown((c) => {
                if (c === null || c <= 1) {
                    clearInterval(t);
                    return 0;
                }
                return c - 1;
            });
        }, 1000);
        return () => clearInterval(t);
    }, [countdown]);

    useEffect(() => {
        if (error.kind === "RATE_LIMITED") {
            setCountdown(error.retryAfterSeconds ?? null);
        } else {
            setCountdown(null);
        }
    }, [error]);

    const isRateLimited = error.kind === "RATE_LIMITED";
    const canRetryNow = !isRetrying && (countdown === null || countdown <= 0);

    return (
        <div className="mx-4 my-2 flex items-start gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
            <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mt-0.5 shrink-0 text-amber-400"
                aria-hidden="true"
            >
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[var(--text-primary)]">
                    {isRateLimited ? "Replies paused briefly" : "Couldn't refresh replies"}
                </p>
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    {isRateLimited
                        ? "Too many requests in a short period — your data is safe."
                        : error.userMessage}
                </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
                {countdown !== null && countdown > 0 && (
                    <span className="text-xs tabular-nums text-[var(--text-muted)]">
                        {countdown}s
                    </span>
                )}
                <button
                    onClick={onRetry}
                    disabled={!canRetryNow}
                    className="text-xs font-medium text-amber-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
                >
                    {isRetrying ? "Retrying…" : "Retry now"}
                </button>
            </div>
        </div>
    );
}

interface RepliesErrorStateProps {
    error: ApiError;
    onRetry: () => void;
}

export function RepliesErrorState({ error, onRetry }: RepliesErrorStateProps) {
    const isTransient = error.kind === "RATE_LIMITED" || error.kind === "UNAVAILABLE" || error.kind === "NETWORK_ERROR";

    return (
        <div className="flex flex-col items-center justify-center h-full py-16 px-6 text-center">
            <div className="w-12 h-12 rounded-xl bg-red-400/10 border border-red-400/20 flex items-center justify-center mb-4">
                <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-red-400"
                    aria-hidden="true"
                >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
            </div>
            <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                {error.kind === "RATE_LIMITED"
                    ? "Replies paused briefly"
                    : error.kind === "UNAVAILABLE" || error.kind === "NETWORK_ERROR"
                        ? "Server temporarily unavailable"
                        : error.kind === "UNAUTHORIZED"
                            ? "Session expired"
                            : "Couldn't load replies"}
            </p>
            <p className="text-xs text-[var(--text-muted)] mb-4">{error.userMessage}</p>
            {isTransient && (
                <button
                    onClick={onRetry}
                    className="text-xs font-medium text-[var(--red-text)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] rounded"
                >
                    Try again
                </button>
            )}
        </div>
    );
}