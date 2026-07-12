"use client";

import { useState, useCallback } from "react";

import type { LearningEventType, LearningOutcome } from "@/app/api/learning/learningApi";

import { useLearningActions, useLearningEventDetail, useLearningEvents, useLearningStats } from "@/app/api/learning/useLearning";
import { TopBar } from "@/app/components/dashboard/TopBar";
import { LearningStatsBar } from "@/app/components/learning/learningStats";
import { LearningFilters } from "@/app/components/learning/learningFilter";
import { LearningTable } from "@/app/components/learning/learning";
import { ResolvePanel } from "@/app/components/learning/Resolve";


export default function LearningPage() {
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const { data: stats, loading: statsLoading, error: statsError, refetch: refetchStats } =
        useLearningStats();

    const {
        data: eventsData,
        loading: eventsLoading,
        error: eventsError,
        params,
        updateParams,
        setPage,
        refetch: refetchEvents,
    } = useLearningEvents({ limit: 20 });

    const { data: detail, loading: detailLoading, error: detailError } =
        useLearningEventDetail(selectedId);

    const handleActionSuccess = useCallback(() => {
        refetchEvents();
        refetchStats();
    }, [refetchEvents, refetchStats]);

    const { resolve, dismiss, isPending, actionError, actionSuccess, clearFeedback } =
        useLearningActions(handleActionSuccess);

    const handleSelect = useCallback(
        (id: string) => {
            clearFeedback();
            setSelectedId((prev) => (prev === id ? null : id));
        },
        [clearFeedback]
    );

    const handleClose = useCallback(() => {
        clearFeedback();
        setSelectedId(null);
    }, [clearFeedback]);

    const pendingCount = stats?.totals.pending ?? 0;

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <TopBar
                title="Learning Events"
                subtitle={
                    pendingCount > 0
                        ? `${pendingCount} pending review`
                        : "AI feedback loop"
                }
                actions={
                    <button
                        onClick={() => { refetchEvents(); refetchStats(); }}
                        aria-label="Refresh learning events"
                        className="w-9 h-9 flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.75"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                        >
                            <polyline points="23 4 23 10 17 10" />
                            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                        </svg>
                    </button>
                }
            />

            <div className="flex flex-1 min-h-0 overflow-hidden">
                <div className="flex flex-col flex-1 min-w-0 overflow-hidden p-6 gap-5">
                    <LearningStatsBar
                        stats={stats}
                        loading={statsLoading}
                        error={statsError}
                    />

                    <LearningFilters
                        eventType={params.eventType as LearningEventType | undefined}
                        outcome={params.outcome as LearningOutcome | undefined}
                        pendingOnly={params.pendingOnly}
                        onEventTypeChange={(v) => updateParams({ eventType: v })}
                        onOutcomeChange={(v) => updateParams({ outcome: v })}
                        onPendingOnlyChange={(v) => updateParams({ pendingOnly: v, outcome: undefined })}
                        disabled={eventsLoading}
                    />

                    <div className="flex-1 min-h-0 overflow-hidden">
                        <LearningTable
                            events={eventsData?.data ?? []}
                            loading={eventsLoading}
                            error={eventsError}
                            selectedId={selectedId}
                            onSelect={handleSelect}
                            page={eventsData?.meta.page ?? 1}
                            totalPages={eventsData?.meta.totalPages ?? 1}
                            total={eventsData?.meta.total ?? 0}
                            onPageChange={setPage}
                        />
                    </div>
                </div>

                <div
                    className={[
                        "flex-shrink-0 border-l border-[var(--border)] bg-[var(--navy-mid)]",
                        "transition-[width] duration-200 ease-in-out overflow-hidden",
                        selectedId ? "w-[400px]" : "w-0",
                    ].join(" ")}
                    aria-hidden={!selectedId}
                >
                    {selectedId && (
                        <ResolvePanel
                            eventId={selectedId}
                            detail={detail}
                            detailLoading={detailLoading}
                            detailError={detailError}
                            actionError={actionError}
                            actionSuccess={actionSuccess}
                            isPending={isPending}
                            onResolve={resolve}
                            onDismiss={dismiss}
                            onClose={handleClose}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}