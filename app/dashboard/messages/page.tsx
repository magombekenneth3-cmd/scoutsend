"use client";

import { useState, useMemo, useEffect, useCallback } from "react";

import { leadName } from "@/app/api/src/lib/message";
import { ApprovalStatus, OutreachMessage } from "@/app/api/src/lib/message/messageHelper";
import { EmptyState } from "@/app/components/message/emptyState";
import { MessageListItem } from "@/app/components/message/MessageListItem";
import { NoSelection } from "@/app/components/message/NoSelection";
import { DetailPanel } from "@/app/components/message/DetailPanel";

export type FilterTab = ApprovalStatus | "ALL";

const TABS: { value: FilterTab; label: string }[] = [
    { value: "ALL", label: "All" },
    { value: "PENDING", label: "Pending" },
    { value: "APPROVED", label: "Approved" },
    { value: "REJECTED", label: "Rejected" },
];

function authHeaders(): Record<string, string> {
    const token = typeof window !== "undefined" ? localStorage.getItem("ss_token") : "";
    return {
        Authorization: `Bearer ${token ?? ""}`,
        "Content-Type": "application/json",
    };
}

export default function MessagesPage() {
    const [messages, setMessages] = useState<OutreachMessage[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [filter, setFilter] = useState<FilterTab>("PENDING");
    const [search, setSearch] = useState("");

    const fetchMessages = useCallback(async () => {
        try {
            setError(null);
            const res = await fetch("/api/outreach-messages", {
                headers: authHeaders(),
            });
            if (!res.ok) throw new Error(`Server error ${res.status}`);
            const data = await res.json();
            const list: OutreachMessage[] = data.data ?? data ?? [];
            setMessages(list);
            setSelectedId((prev) => {
                if (prev && list.find((m) => m.id === prev)) return prev;
                return list.find((m) => m.approvalStatus === "PENDING")?.id ?? null;
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load messages");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchMessages();
    }, [fetchMessages]);

    const counts = useMemo(
        () => ({
            ALL: messages.length,
            PENDING: messages.filter((m) => m.approvalStatus === "PENDING").length,
            APPROVED: messages.filter((m) => m.approvalStatus === "APPROVED").length,
            REJECTED: messages.filter((m) => m.approvalStatus === "REJECTED").length,
        }),
        [messages]
    );

    const filtered = useMemo(() => {
        let list = messages;
        if (filter !== "ALL") list = list.filter((m) => m.approvalStatus === filter);
        if (search.trim()) {
            const q = search.toLowerCase();
            list = list.filter(
                (m) =>
                    leadName(m.lead).toLowerCase().includes(q) ||
                    m.lead.companyName.toLowerCase().includes(q) ||
                    m.subject.toLowerCase().includes(q)
            );
        }
        return [...list].sort((a, b) => {
            if (a.approvalStatus === "PENDING" && b.approvalStatus === "PENDING") {
                return (b.spamRiskScore ?? 0) - (a.spamRiskScore ?? 0);
            }
            return 0;
        });
    }, [messages, filter, search]);

    const selected = messages.find((m) => m.id === selectedId) ?? null;

    const handleApprove = useCallback(async (id: string, editedSubject?: string, editedBody?: string) => {
        try {
            const res = await fetch(`/api/outreach-messages/${id}/approve`, {
                method: "POST",
                headers: authHeaders(),
            });
            if (!res.ok) throw new Error(`Approve failed ${res.status}`);
            setMessages((prev) =>
                prev.map((m) => (m.id === id ? {
                    ...m,
                    approvalStatus: "APPROVED" as ApprovalStatus,
                    ...(editedSubject ? { subject: editedSubject } : {}),
                    ...(editedBody ? { body: editedBody } : {})
                } : m))
            );
            setSelectedId((prev) => {
                const nextPending = filtered.find(
                    (m) => m.id !== id && m.approvalStatus === "PENDING"
                );
                return nextPending?.id ?? prev;
            });
        } catch (err) {
            console.error("Approve error:", err);
        }
    }, [filtered]);

    const handleReject = useCallback(async (id: string) => {
        try {
            const res = await fetch(`/api/outreach-messages/${id}/reject`, {
                method: "POST",
                headers: authHeaders(),
            });
            if (!res.ok) throw new Error(`Reject failed ${res.status}`);
            setMessages((prev) =>
                prev.map((m) => (m.id === id ? { ...m, approvalStatus: "REJECTED" as ApprovalStatus } : m))
            );
            setSelectedId((prev) => {
                const nextPending = filtered.find(
                    (m) => m.id !== id && m.approvalStatus === "PENDING"
                );
                return nextPending?.id ?? prev;
            });
        } catch (err) {
            console.error("Reject error:", err);
        }
    }, [filtered]);

    return (
        <div className="flex flex-col h-screen overflow-hidden bg-white dark:bg-slate-950">
            <div className="flex-shrink-0 h-14 border-b border-slate-200 dark:border-slate-800 px-6 flex items-center justify-between gap-4 bg-white dark:bg-slate-900">
                <div className="flex items-center gap-3">
                    <h1 className="font-bold text-base text-slate-900 dark:text-slate-100 tracking-tight">
                        Messages
                    </h1>
                    {counts.PENDING > 0 && (
                        <span className="text-xs font-bold bg-red-500 text-white rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 tabular-nums">
                            {counts.PENDING}
                        </span>
                    )}
                </div>

                <div className="relative flex-1 max-w-[280px]">
                    <svg
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <input
                        type="search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search messages…"
                        aria-label="Search messages"
                        className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500/40 transition-colors"
                    />
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden min-h-0">
                <div className="w-[320px] flex-shrink-0 flex flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                    <div className="flex-shrink-0 border-b border-slate-100 dark:border-slate-800 px-4 pt-3">
                        <div className="flex gap-1" role="tablist" aria-label="Filter messages">
                            {TABS.map((tab) => (
                                <button
                                    key={tab.value}
                                    role="tab"
                                    aria-selected={filter === tab.value}
                                    onClick={() => setFilter(tab.value)}
                                    className={[
                                        "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all duration-150 mb-3",
                                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500",
                                        filter === tab.value
                                            ? "bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400"
                                            : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800",
                                    ].join(" ")}
                                >
                                    {tab.label}
                                    {counts[tab.value] > 0 && (
                                        <span
                                            className={`text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center ${filter === tab.value
                                                ? "bg-violet-600 dark:bg-violet-500 text-white"
                                                : "bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
                                                }`}
                                        >
                                            {counts[tab.value]}
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto">
                        {loading ? (
                            <div className="flex items-center justify-center h-32 text-sm text-slate-400">
                                Loading…
                            </div>
                        ) : error ? (
                            <div className="flex flex-col items-center justify-center h-32 gap-2 px-4">
                                <p className="text-sm text-red-500 text-center">{error}</p>
                                <button
                                    onClick={fetchMessages}
                                    className="text-xs text-violet-600 hover:underline"
                                >
                                    Retry
                                </button>
                            </div>
                        ) : filtered.length === 0 ? (
                            <EmptyState filter={filter} />
                        ) : (
                            filtered.map((msg) => (
                                <MessageListItem
                                    key={msg.id}
                                    message={msg}
                                    selected={selectedId === msg.id}
                                    onClick={() => setSelectedId(msg.id)}
                                />
                            ))
                        )}
                    </div>
                </div>

                <div className="flex-1 overflow-hidden min-w-0 bg-slate-50 dark:bg-slate-950">
                    {selected ? (
                        <DetailPanel
                            key={selected.id}
                            message={selected}
                            onApprove={handleApprove}
                            onReject={handleReject}
                        />
                    ) : (
                        <NoSelection />
                    )}
                </div>
            </div>
        </div>
    );
}