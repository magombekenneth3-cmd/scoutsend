"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/app/components/dashboard/TopBar";
import { RepliesMeta, RepliesTab, Reply, TabCounts } from "@/app/api/src/lib/reply/replyTypes";
import { RepliesSummaryStrip } from "@/app/components/replies/replySummary";
import { RepliesIntentTabs } from "@/app/components/replies/repliesIntentTabs";
import { ReplyListSkeleton } from "@/app/components/replies/replySkeleton";
import { RepliesErrorState, RepliesErrorBanner } from "@/app/components/replies/replyErrorState";
import { RepliesEmptyState } from "@/app/components/replies/replyEmptyState";
import { ReplyCard } from "@/app/components/replies/replyCard";
import { ReplyDetailPanel } from "@/app/components/replies/replyDetailPanel";
import {
    fetchReplies,
    fetchTabCounts,
    patchReply,
    ApiRequestError,
    ApiError,
    isApiRequestError,
} from "@/app/api/replies/replyApi";

const DEFAULT_META: RepliesMeta = { total: 0, page: 1, limit: 40, totalPages: 1 };

const MAX_AUTO_RETRIES = 3;
const BACKOFF_JITTER_MS = 1_000;
const UNAVAILABLE_BASE_MS = 5_000;

function withJitter(ms: number): number {
    return ms + Math.floor(Math.random() * BACKOFF_JITTER_MS);
}

export default function RepliesPage() {
    const router = useRouter();
    const [activeTab, setActiveTab] = useState<RepliesTab>("ALL");
    const [replies, setReplies] = useState<Reply[]>([]);
    const [meta, setMeta] = useState<RepliesMeta>(DEFAULT_META);
    const [initialLoading, setInitialLoading] = useState(true);
    const [refreshError, setRefreshError] = useState<ApiError | null>(null);
    const [initialError, setInitialError] = useState<ApiError | null>(null);
    const [isRetrying, setIsRetrying] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [tabCounts, setTabCounts] = useState<TabCounts>({});
    const listRef = useRef<HTMLDivElement>(null);

    const hasData = replies.length > 0;
    const selectedReply = replies.find((r) => r.id === selectedId) ?? null;

    const inFlightRef = useRef<AbortController | null>(null);
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const retryCountRef = useRef(0);

    const cancelInFlight = useCallback(() => {
        if (inFlightRef.current) {
            inFlightRef.current.abort();
            inFlightRef.current = null;
        }
        if (retryTimerRef.current !== null) {
            clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
        }
    }, []);

    const loadReplies = useCallback(async (tab: RepliesTab, page = 1, isInitial = false) => {
        cancelInFlight();
        const controller = new AbortController();
        inFlightRef.current = controller;

        if (isInitial) {
            setInitialLoading(true);
            setInitialError(null);
        }
        setRefreshError(null);
        setIsRetrying(false);

        try {
            const json = await fetchReplies(tab, page, controller.signal);
            if (controller.signal.aborted) return;
            setReplies(json.data);
            setMeta(json.meta);
            setInitialError(null);
            setRefreshError(null);
            retryCountRef.current = 0;
        } catch (e) {
            if (controller.signal.aborted) return;
            if (isApiRequestError(e)) {
                const err = e.apiError;
                if (err.kind === "UNAUTHORIZED") {
                    router.replace("/auth/login");
                    return;
                }
                if (isInitial && !hasData) {
                    setInitialError(err);
                } else {
                    setRefreshError(err);
                    scheduleAutoRetry(tab, page, err);
                }
            } else {
                const fallback: ApiError = {
                    kind: "NETWORK_ERROR",
                    status: null,
                    retryAfterSeconds: null,
                    userMessage: "Unable to reach the server. Check your connection.",
                };
                if (isInitial && !hasData) {
                    setInitialError(fallback);
                } else {
                    setRefreshError(fallback);
                    scheduleAutoRetry(tab, page, fallback);
                }
            }
        } finally {
            if (!controller.signal.aborted) {
                setInitialLoading(false);
                setIsRetrying(false);
                inFlightRef.current = null;
            }
        }
    }, [cancelInFlight, hasData, router]);

    function scheduleAutoRetry(tab: RepliesTab, page: number, err: ApiError) {
        if (retryCountRef.current >= MAX_AUTO_RETRIES) return;
        const isTransient =
            err.kind === "RATE_LIMITED" || err.kind === "UNAVAILABLE" || err.kind === "NETWORK_ERROR";
        if (!isTransient) return;

        let delayMs: number;
        if (err.kind === "RATE_LIMITED" && err.retryAfterSeconds !== null) {
            delayMs = withJitter(err.retryAfterSeconds * 1000);
        } else {
            const backoff = UNAVAILABLE_BASE_MS * Math.pow(2, retryCountRef.current);
            delayMs = withJitter(Math.min(backoff, 60_000));
        }

        retryCountRef.current += 1;
        retryTimerRef.current = setTimeout(async () => {
            retryTimerRef.current = null;
            if (inFlightRef.current) return;
            setIsRetrying(true);
            await loadReplies(tab, page, false);
        }, delayMs);
    }

    const loadCounts = useCallback(async (signal?: AbortSignal) => {
        const counts = await fetchTabCounts(signal);
        setTabCounts(counts as TabCounts);
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        loadCounts(controller.signal);
        return () => controller.abort();
    }, [loadCounts]);

    useEffect(() => {
        retryCountRef.current = 0;
        setSelectedId(null);
        listRef.current?.scrollTo({ top: 0 });
        loadReplies(activeTab, 1, true);
        return () => cancelInFlight();
    }, [activeTab]);

    async function handleSelectReply(id: string) {
        if (selectedId === id) {
            setSelectedId(null);
            return;
        }
        setSelectedId(id);
        const reply = replies.find((r) => r.id === id);
        if (reply && !reply.isRead) {
            setReplies((prev) => prev.map((r) => (r.id === id ? { ...r, isRead: true } : r)));
            try {
                await patchReply(id, { isRead: true });
            } catch {
                setReplies((prev) => prev.map((r) => (r.id === id ? { ...r, isRead: false } : r)));
            }
        }
    }

    function handleSnoozed(id: string) {
        setReplies((prev) => prev.filter((r) => r.id !== id));
        setSelectedId(null);
        setTabCounts((prev) => {
            const next = { ...prev };
            if (next.ALL !== undefined) next.ALL = Math.max(0, next.ALL - 1);
            if (next.NEEDS_REVIEW !== undefined) next.NEEDS_REVIEW = Math.max(0, next.NEEDS_REVIEW - 1);
            if (selectedReply) {
                const intentKey = selectedReply.intent as RepliesTab;
                if (next[intentKey] !== undefined) {
                    next[intentKey] = Math.max(0, (next[intentKey] ?? 1) - 1);
                }
            }
            return next;
        });
    }

    function handleIntentUpdated(id: string, newIntent: RepliesTab) {
        const previousIntent = selectedReply?.intent as RepliesTab | undefined;
        setReplies((prev) => prev.map((r) => (r.id === id ? { ...r, intent: newIntent as any } : r)));
        if (activeTab !== "ALL" && activeTab !== "NEEDS_REVIEW" && activeTab !== newIntent) {
            setReplies((prev) => prev.filter((r) => r.id !== id));
            setSelectedId(null);
        }
        setTabCounts((prev) => {
            const next = { ...prev };
            if (previousIntent && next[previousIntent] !== undefined) {
                next[previousIntent] = Math.max(0, (next[previousIntent] ?? 1) - 1);
            }
            if (next[newIntent] !== undefined) {
                next[newIntent] = (next[newIntent] ?? 0) + 1;
            }
            return next;
        });
    }

    function handleMarkReviewed(id: string) {
        setReplies((prev) => prev.map((r) => (r.id === id ? { ...r, requiresHumanReview: false } : r)));
        setTabCounts((prev) => ({
            ...prev,
            NEEDS_REVIEW: Math.max(0, (prev.NEEDS_REVIEW ?? 1) - 1),
        }));
        if (activeTab === "NEEDS_REVIEW") {
            setReplies((prev) => prev.filter((r) => r.id !== id));
            setSelectedId(null);
        }
    }

    function handleDraftSent(id: string) {
        const sentAt = new Date().toISOString();
        setReplies((prev) =>
            prev.map((r) => r.id === id ? { ...r, draftSentAt: sentAt, requiresHumanReview: false } : r)
        );
        setTabCounts((prev) => ({
            ...prev,
            NEEDS_REVIEW: Math.max(0, (prev.NEEDS_REVIEW ?? 1) - 1),
        }));
        if (activeTab === "NEEDS_REVIEW") {
            setReplies((prev) => prev.filter((r) => r.id !== id));
            setSelectedId(null);
        }
    }

    function handleTabChange(tab: RepliesTab) {
        setActiveTab(tab);
    }

    function handlePageChange(page: number) {
        loadReplies(activeTab, page, false);
        listRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }

    function handleManualRetry() {
        if (inFlightRef.current) return;
        retryCountRef.current = 0;
        loadReplies(activeTab, meta.page, !hasData);
    }

    const needsReviewCount = tabCounts.NEEDS_REVIEW ?? 0;
    const totalReplies = tabCounts.ALL ?? 0;

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <TopBar
                title="Replies"
                subtitle={`${totalReplies} total inbound replies`}
                actions={
                    needsReviewCount > 0 ? (
                        <button
                            onClick={() => handleTabChange("NEEDS_REVIEW")}
                            className="flex items-center gap-2 h-8 px-3 rounded-lg bg-amber-400/10 border border-amber-400/20 text-amber-400 text-xs font-semibold hover:bg-amber-400/20 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                        >
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" aria-hidden="true" />
                            {needsReviewCount} need review
                        </button>
                    ) : null
                }
            />

            <RepliesSummaryStrip
                meta={meta}
                tabCounts={tabCounts}
                activeTab={activeTab}
                onPageChange={handlePageChange}
            />

            <RepliesIntentTabs
                activeTab={activeTab}
                tabCounts={tabCounts}
                onChange={handleTabChange}
            />

            {refreshError && (
                <RepliesErrorBanner
                    error={refreshError}
                    onRetry={handleManualRetry}
                    isRetrying={isRetrying}
                />
            )}

            <div className="flex flex-1 overflow-hidden">
                <div
                    ref={listRef}
                    className={[
                        "flex flex-col overflow-y-auto flex-shrink-0 transition-all duration-200",
                        selectedReply ? "w-[380px] border-r border-[var(--border)]" : "flex-1",
                    ].join(" ")}
                >
                    {initialLoading ? (
                        <ReplyListSkeleton />
                    ) : initialError ? (
                        <RepliesErrorState error={initialError} onRetry={handleManualRetry} />
                    ) : replies.length === 0 ? (
                        <RepliesEmptyState tab={activeTab} />
                    ) : (
                        replies.map((reply) => (
                            <ReplyCard
                                key={reply.id}
                                reply={reply}
                                selected={reply.id === selectedId}
                                onClick={() => handleSelectReply(reply.id)}
                            />
                        ))
                    )}
                </div>

                {selectedReply && (
                    <div className="flex-1 min-w-0 overflow-hidden">
                        <ReplyDetailPanel
                            reply={selectedReply}
                            onClose={() => setSelectedId(null)}
                            onMarkReviewed={handleMarkReviewed}
                            onDraftSent={handleDraftSent}
                            onSnoozed={handleSnoozed}
                            onIntentUpdated={handleIntentUpdated}
                        />
                    </div>
                )}

                {!selectedReply && !initialLoading && replies.length > 0 && (
                    <div className="hidden lg:flex flex-1 items-center justify-center text-center px-8">
                        <div>
                            <div className="w-12 h-12 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] flex items-center justify-center mx-auto mb-3">
                                <svg
                                    width="20"
                                    height="20"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    className="text-[var(--text-muted)]"
                                    aria-hidden="true"
                                >
                                    <polyline points="9 17 4 12 9 7" />
                                    <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
                                </svg>
                            </div>
                            <p className="text-sm font-medium text-[var(--text-secondary)]">Select a reply</p>
                            <p className="text-xs text-[var(--text-muted)] mt-1">Click any reply to see details</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}