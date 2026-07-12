"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/app/components/dashboard/TopBar";
import { RepliesMeta, RepliesTab, Reply, TabCounts } from "@/app/api/src/lib/reply/replyTypes";
import { RepliesSummaryStrip } from "@/app/components/replies/replySummary";
import { RepliesIntentTabs } from "@/app/components/replies/repliesIntentTabs";
import { ReplyListSkeleton } from "@/app/components/replies/replySkeleton";
import { RepliesErrorState } from "@/app/components/replies/replyErrorState";
import { RepliesEmptyState } from "@/app/components/replies/replyEmptyState";
import { ReplyCard } from "@/app/components/replies/replyCard";
import { ReplyDetailPanel } from "@/app/components/replies/replyDetailPanel";
import { fetchReplies, fetchTabCount } from "@/app/api/replies/replyApi";

const INTENT_KEYS: RepliesTab[] = [
    "POSITIVE",
    "MEETING_REQUEST",
    "QUESTION",
    "NEGATIVE",
    "NOT_INTERESTED",
    "OUT_OF_OFFICE",
    "UNKNOWN",
];

const DEFAULT_META: RepliesMeta = { total: 0, page: 1, limit: 40, totalPages: 1 };

export default function RepliesPage() {
    const router = useRouter();
    const [activeTab, setActiveTab] = useState<RepliesTab>("ALL");
    const [replies, setReplies] = useState<Reply[]>([]);
    const [meta, setMeta] = useState<RepliesMeta>(DEFAULT_META);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [tabCounts, setTabCounts] = useState<TabCounts>({});
    const listRef = useRef<HTMLDivElement>(null);

    const selectedReply = replies.find((r) => r.id === selectedId) ?? null;

    const loadReplies = useCallback(async (tab: RepliesTab, page = 1) => {
        setLoading(true);
        setError(null);
        try {
            const json = await fetchReplies(tab, page);
            setReplies(json.data);
            setMeta(json.meta);
        } catch (e) {
            if ((e as { status?: number })?.status === 401) {
                router.replace("/auth/login");
                return;
            }
            setError((e as Error).message);
        } finally {
            setLoading(false);
        }
    }, [router]);

    useEffect(() => {
        const allTabs: RepliesTab[] = ["ALL", "NEEDS_REVIEW", ...INTENT_KEYS];
        Promise.allSettled(allTabs.map((tab) => fetchTabCount(tab))).then((results) => {
            const counts: TabCounts = {};
            results.forEach((r, i) => {
                if (r.status === "fulfilled") {
                    counts[allTabs[i] as keyof TabCounts] = r.value;
                }
            });
            setTabCounts(counts);
        });
    }, []);

    useEffect(() => {
        loadReplies(activeTab);
        setSelectedId(null);
        listRef.current?.scrollTo({ top: 0 });
    }, [activeTab, loadReplies]);

    function handleMarkReviewed(id: string) {
        setReplies((prev) =>
            prev.map((r) => (r.id === id ? { ...r, requiresHumanReview: false } : r))
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

    function handleDraftSent(id: string) {
        const sentAt = new Date().toISOString();
        setReplies((prev) =>
            prev.map((r) =>
                r.id === id
                    ? { ...r, draftSentAt: sentAt, requiresHumanReview: false }
                    : r
            )
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
        loadReplies(activeTab, page);
        listRef.current?.scrollTo({ top: 0, behavior: "smooth" });
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

            <div className="flex flex-1 overflow-hidden">
                <div
                    ref={listRef}
                    className={[
                        "flex flex-col overflow-y-auto flex-shrink-0 transition-all duration-200",
                        selectedReply ? "w-[380px] border-r border-[var(--border)]" : "flex-1",
                    ].join(" ")}
                >
                    {loading ? (
                        <ReplyListSkeleton />
                    ) : error ? (
                        <RepliesErrorState message={error} onRetry={() => loadReplies(activeTab)} />
                    ) : replies.length === 0 ? (
                        <RepliesEmptyState tab={activeTab} />
                    ) : (
                        replies.map((reply) => (
                            <ReplyCard
                                key={reply.id}
                                reply={reply}
                                selected={reply.id === selectedId}
                                onClick={() => setSelectedId(reply.id === selectedId ? null : reply.id)}
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
                        />
                    </div>
                )}

                {!selectedReply && !loading && replies.length > 0 && (
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