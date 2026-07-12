"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { TopBar } from "@/app/components/dashboard/TopBar";

import { FilterType, Suppression, SuppressionListResponse, SuppressionStats } from "@/app/api/src/lib/suppression/types";
import { SuppressionStatsBar } from "@/app/components/suppression/SuppressionStatus";
import { CheckSuppressionWidget } from "@/app/components/suppression/CheckSuppression";
import { SuppressionRow } from "@/app/components/suppression/SuppressionRow";
import { AddSuppressionModal } from "@/app/components/suppression/SuppressionModal";
import { BulkImportModal } from "@/app/components/suppression/BulkImportModal";
import { DeleteConfirmDialog } from "@/app/components/suppression/DeleteConfirmModal";


const PAGE_SIZE = 25;

export default function SuppressionPage() {
    const [items, setItems] = useState<Suppression[]>([]);
    const [meta, setMeta] = useState({ total: 0, page: 1, limit: PAGE_SIZE, totalPages: 1 });
    const [stats, setStats] = useState<SuppressionStats | null>(null);
    const [statsLoading, setStatsLoading] = useState(true);
    const [listLoading, setListLoading] = useState(true);
    const [listError, setListError] = useState<string | null>(null);

    const [search, setSearch] = useState("");
    const [filterType, setFilterType] = useState<FilterType>("all");
    const [page, setPage] = useState(1);

    const [addOpen, setAddOpen] = useState(false);
    const [bulkOpen, setBulkOpen] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<Suppression | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const fetchStats = useCallback(async () => {
        setStatsLoading(true);
        try {
            const res = await fetch("/api/suppression/stats");
            if (!res.ok) return;
            setStats(await res.json());
        } finally {
            setStatsLoading(false);
        }
    }, []);

    const fetchList = useCallback(async (opts: {
        search: string;
        type: FilterType;
        page: number;
    }) => {
        setListLoading(true);
        setListError(null);
        const p = new URLSearchParams();
        p.set("page", String(opts.page));
        p.set("limit", String(PAGE_SIZE));
        p.set("type", opts.type);

        const q = opts.search.trim();
        if (q) {
            const isEmail = q.includes("@");
            if (isEmail) p.set("email", q);
            else p.set("domain", q);
        }

        try {
            const res = await fetch(`/api/suppression?${p}`);
            if (!res.ok) throw new Error(`Server error ${res.status}`);
            const json: SuppressionListResponse = await res.json();
            setItems(json.data);
            setMeta(json.meta);
        } catch (e) {
            setListError((e as Error).message);
        } finally {
            setListLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchStats();
    }, [fetchStats]);

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            fetchList({ search, type: filterType, page });
        }, search ? 300 : 0);
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [search, filterType, page, fetchList]);

    function refresh() {
        fetchList({ search, type: filterType, page });
        fetchStats();
    }

    function changeFilter(t: FilterType) {
        setFilterType(t);
        setPage(1);
    }

    function changeSearch(val: string) {
        setSearch(val);
        setPage(1);
    }

    async function confirmDelete() {
        if (!deleteTarget) return;
        setDeletingId(deleteTarget.id);
        try {
            const res = await fetch(`/api/suppression/${deleteTarget.id}`, { method: "DELETE" });
            if (!res.ok && res.status !== 204) throw new Error(`Error ${res.status}`);
            setItems((prev) => prev.filter((i) => i.id !== deleteTarget.id));
            setMeta((prev) => ({ ...prev, total: Math.max(0, prev.total - 1) }));
            setStats((prev) => {
                if (!prev) return prev;
                const isEmail = !!deleteTarget.email;
                return {
                    total: Math.max(0, prev.total - 1),
                    emailCount: isEmail ? Math.max(0, prev.emailCount - 1) : prev.emailCount,
                    domainCount: !isEmail ? Math.max(0, prev.domainCount - 1) : prev.domainCount,
                };
            });
        } finally {
            setDeletingId(null);
            setDeleteTarget(null);
        }
    }

    const TABLE_HEADERS = ["Address", "Reason", "Source", "Added", ""];

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <TopBar
                title="Suppression List"
                subtitle={stats ? `${stats.total.toLocaleString()} blocked address${stats.total !== 1 ? "es" : ""}` : "Loading…"}
                actions={
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setBulkOpen(true)}
                            className="flex items-center gap-2 h-8 px-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-red)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                        >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                            </svg>
                            Bulk Import
                        </button>
                        <button
                            onClick={() => setAddOpen(true)}
                            className="flex items-center gap-2 h-8 px-3 rounded-lg bg-[var(--red)] text-white text-xs font-semibold hover:bg-[var(--red-dim)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                        >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                            Add Entry
                        </button>
                    </div>
                }
            />

            <div className="flex-1 overflow-y-auto">
                <div className="max-w-5xl mx-auto px-6 py-6 space-y-5">

                    <SuppressionStatsBar stats={stats} loading={statsLoading} />

                    <CheckSuppressionWidget />

                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
                        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] flex-wrap gap-y-2">
                            <div className="relative flex-1 min-w-[180px]">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none">
                                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                                </svg>
                                <input
                                    type="text"
                                    value={search}
                                    onChange={(e) => changeSearch(e.target.value)}
                                    placeholder="Search emails or domains…"
                                    aria-label="Search suppression list"
                                    className="w-full h-8 pl-8 pr-3 rounded-lg bg-[var(--navy-mid)] border border-[var(--border)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-red)] focus:ring-1 focus:ring-[var(--red)]/30 transition-colors font-mono"
                                />
                            </div>

                            <div className="flex items-center gap-0.5 rounded-lg bg-[var(--surface-2)] p-0.5">
                                {(["all", "email", "domain"] as FilterType[]).map((t) => (
                                    <button key={t} onClick={() => changeFilter(t)}
                                        className={["px-3 h-7 text-xs font-medium rounded-md transition-all duration-150 capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]", filterType === t ? "bg-[var(--surface)] text-[var(--text-primary)] shadow-sm border border-[var(--border)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"].join(" ")}>
                                        {t}
                                    </button>
                                ))}
                            </div>

                            {(search || filterType !== "all") && (
                                <button onClick={() => { changeSearch(""); changeFilter("all"); }}
                                    className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none">
                                    Clear
                                </button>
                            )}

                            <span className="ml-auto text-xs text-[var(--text-muted)] tabular-nums">
                                {meta.total.toLocaleString()} result{meta.total !== 1 ? "s" : ""}
                            </span>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[600px]">
                                <thead>
                                    <tr className="border-b border-[var(--border)]">
                                        {TABLE_HEADERS.map((h) => (
                                            <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {listLoading ? (
                                        Array.from({ length: 7 }).map((_, i) => (
                                            <tr key={i} className="border-b border-[var(--border)]">
                                                {[220, 160, 80, 60, 40].map((w, j) => (
                                                    <td key={j} className="px-4 py-3">
                                                        <div className={`h-3 rounded bg-[var(--surface-2)] animate-pulse`} style={{ width: w }} />
                                                    </td>
                                                ))}
                                            </tr>
                                        ))
                                    ) : listError ? (
                                        <tr>
                                            <td colSpan={5} className="px-4 py-12 text-center">
                                                <p className="text-sm font-medium text-[var(--text-primary)] mb-1">Failed to load</p>
                                                <p className="text-xs text-[var(--text-muted)] mb-3">{listError}</p>
                                                <button onClick={() => fetchList({ search, type: filterType, page })} className="text-xs text-[var(--red)] hover:underline focus-visible:outline-none">Retry</button>
                                            </td>
                                        </tr>
                                    ) : items.length === 0 ? (
                                        <tr>
                                            <td colSpan={5} className="px-4 py-14 text-center">
                                                <div className="flex flex-col items-center gap-3">
                                                    <div className="w-10 h-10 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center">
                                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--text-muted)]">
                                                            <circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                                                        </svg>
                                                    </div>
                                                    <p className="text-sm font-medium text-[var(--text-secondary)]">
                                                        {search || filterType !== "all" ? "No results match your filters" : "No suppressions yet"}
                                                    </p>
                                                    <p className="text-xs text-[var(--text-muted)]">
                                                        {search || filterType !== "all" ? "Try clearing your filters" : "Add emails or domains to block sending to them"}
                                                    </p>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : (
                                        items.map((item) => (
                                            <SuppressionRow
                                                key={item.id}
                                                item={item}
                                                onDelete={setDeleteTarget}
                                                deleting={deletingId === item.id}
                                            />
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {!listLoading && !listError && meta.totalPages > 1 && (
                            <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)]">
                                <p className="text-xs text-[var(--text-muted)] tabular-nums">
                                    {((meta.page - 1) * meta.limit) + 1}–{Math.min(meta.page * meta.limit, meta.total)} of {meta.total.toLocaleString()}
                                </p>
                                <div className="flex items-center gap-1">
                                    <button onClick={() => setPage((p) => p - 1)} disabled={page <= 1}
                                        aria-label="Previous page"
                                        className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] disabled:opacity-30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                                    </button>

                                    {Array.from({ length: Math.min(meta.totalPages, 7) }).map((_, i) => {
                                        const p = i + 1;
                                        return (
                                            <button key={p} onClick={() => setPage(p)}
                                                className={["w-7 h-7 rounded-lg text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]", page === p ? "bg-[var(--red-glow)] text-[var(--red)] border border-[var(--border-red)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)]"].join(" ")}>
                                                {p}
                                            </button>
                                        );
                                    })}

                                    <button onClick={() => setPage((p) => p + 1)} disabled={page >= meta.totalPages}
                                        aria-label="Next page"
                                        className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] disabled:opacity-30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <AddSuppressionModal open={addOpen} onClose={() => setAddOpen(false)} onAdded={refresh} />
            <BulkImportModal open={bulkOpen} onClose={() => setBulkOpen(false)} onImported={refresh} />
            <DeleteConfirmDialog
                open={!!deleteTarget}
                target={deleteTarget?.email ?? deleteTarget?.domain ?? ""}
                onConfirm={confirmDelete}
                onCancel={() => setDeleteTarget(null)}
                deleting={deletingId === deleteTarget?.id}
            />
        </div>
    );
}