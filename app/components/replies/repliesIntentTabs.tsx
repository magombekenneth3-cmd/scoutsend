"use client";

import { INTENT_TABS } from "@/app/api/src/lib/reply/replyConfig";
import { RepliesTab, TabCounts } from "@/app/api/src/lib/reply/replyTypes";


interface RepliesIntentTabsProps {
    activeTab: RepliesTab;
    tabCounts: TabCounts;
    onChange: (tab: RepliesTab) => void;
}

export function RepliesIntentTabs({ activeTab, tabCounts, onChange }: RepliesIntentTabsProps) {
    return (
        <div
            role="tablist"
            aria-label="Filter replies by intent"
            className="flex items-center gap-0.5 px-4 py-2.5 border-b border-[var(--border)] bg-[var(--navy-mid)] overflow-x-auto flex-shrink-0"
            style={{ scrollbarWidth: "none" }}
        >
            {INTENT_TABS.map((tab) => {
                const count = tabCounts[tab.id as keyof TabCounts];
                const isActive = activeTab === tab.id;
                const hasNeedsReview = tab.id === "NEEDS_REVIEW" && (count ?? 0) > 0;

                return (
                    <button
                        key={tab.id}
                        role="tab"
                        aria-selected={isActive}
                        onClick={() => onChange(tab.id)}
                        title={tab.desc}
                        className={[
                            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all duration-150",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]",
                            isActive
                                ? "bg-[var(--red-glow)] text-[var(--red)] border border-[var(--border-red)]"
                                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)]",
                            hasNeedsReview && !isActive ? "text-amber-400/80" : "",
                        ].join(" ")}
                    >
                        {hasNeedsReview && (
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0 animate-pulse" aria-hidden="true" />
                        )}
                        {tab.label}
                        {count !== undefined && count > 0 && (
                            <span
                                className={[
                                    "text-[10px] font-bold tabular-nums px-1.5 py-px rounded-full min-w-[18px] text-center",
                                    isActive
                                        ? "bg-[var(--red)] text-white"
                                        : "bg-[var(--surface-2)] text-[var(--text-muted)]",
                                ].join(" ")}
                                aria-label={`${count} replies`}
                            >
                                {count > 99 ? "99+" : count}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}