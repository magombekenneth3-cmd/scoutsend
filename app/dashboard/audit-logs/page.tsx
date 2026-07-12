"use client";

import { AuditLog, AuditLogRow } from "@/app/components/audit/AuditLogRow"
import { TopBar } from "@/app/components/dashboard/TopBar";
import { useState, useEffect, useCallback, useRef } from "react";
import { AuditSkeletonCard } from "@/app/components/audit/AuditSkeleton";
import { AuditSkeletonRow } from "@/app/components/audit/AuditSkeleton";
import { AuditEmptyState } from "@/app/components/audit/AuditEmptyState";
import { AuditFilters } from "@/app/components/audit/AuditFilters";
import { AuditLogCard } from "@/app/components/audit/AuditLogCard";


interface AuditResponse {
    data: AuditLog[];
    meta: { total: number; page: number; limit: number; totalPages: number };
}

const PAGE_SIZE = 25;
const TABLE_HEADERS = ["Time", "Action", "User", "Entity", "IP", ""];

export default function AuditLogsPage() {
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [meta, setMeta] = useState({ total: 0, page: 1, limit: PAGE_SIZE, totalPages: 1 });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Filters
    const [search, setSearch] = useState("");
    const [action, setAction] = useState("");
    const [entityType, setEntityType] = useState("");
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [page, setPage] = useState(1);

    // Expanded row (desktop)
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const fetchLogs = useCallback(
        async (opts: {
            search: string;
            action: string;
            entityType: string;
            startDate: string;
            endDate: string;
            page: number;
        }) => {
            setLoading(true);
            setError(null);
            const p = new URLSearchParams();
            p.set("page", String(opts.page));
            p.set("limit", String(PAGE_SIZE));
            if (opts.search.trim()) p.set("search", opts.search.trim());
            if (opts.action) p.set("action", opts.action);
            if (opts.entityType) p.set("entityType", opts.entityType);
            if (opts.startDate) p.set("startDate", opts.startDate);
            if (opts.endDate) p.set("endDate", opts.endDate);
            try {
                const res = await fetch(`/api/audit-logs?${p}`);
                if (!res.ok) throw new Error(`Server error ${res.status}`);
                const json: AuditResponse = await res.json();
                setLogs(json.data);
                setMeta(json.meta);
            } catch (e) {
                setError((e as Error).message);
            } finally {
                setLoading(false);
            }
        },
        []
    );

    // Debounce re-fetch whenever filters change
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(
            () => fetchLogs({ search, action, entityType, startDate, endDate, page }),
            search ? 300 : 0
        );
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [search, action, entityType, startDate, endDate, page, fetchLogs]);

    function resetFilters() {
        setSearch("");
        setAction("");
        setEntityType("");
        setStartDate("");
        setEndDate("");
        setPage(1);
    }

    function handleFilterChange<T>(setter: (v: T) => void) {
        return (v: T) => {
            setter(v);
            setPage(1);
            setExpandedId(null);
        };
    }

    const isFiltered = !!(search || action || entityType || startDate || endDate);

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* ── Top Bar ─────────────────────────────────────────────────────── */}
            <TopBar
                title="Audit Log"
                subtitle={
                    loading
                        ? "Loading…"
                        : `${meta.total.toLocaleString()} event${meta.total !== 1 ? "s" : ""}`
                }
                actions={
                    <button
                        onClick={() => fetchLogs({ search, action, entityType, startDate, endDate, page })}
                        aria-label="Refresh"
                        className="flex items-center justify-center w-8 h-8 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        <svg
                            width="13"
                            height="13"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            className={loading ? "animate-spin" : ""}
                        >
                            <path d="M21 2v6h-6" />
                            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                            <path d="M3 22v-6h6" />
                            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                        </svg>
                    </button>
                }
            />

            {/* ── Filters ─────────────────────────────────────────────────────── */}
            <div className="px-4 sm:px-6 py-3 flex-shrink-0 border-b border-[var(--border)] overflow-x-auto">
                <AuditFilters
                    search={search}
                    action={action}
                    entityType={entityType}
                    startDate={startDate}
                    endDate={endDate}
                    onSearch={handleFilterChange(setSearch)}
                    onAction={handleFilterChange(setAction)}
                    onEntityType={handleFilterChange(setEntityType)}
                    onStartDate={handleFilterChange(setStartDate)}
                    onEndDate={handleFilterChange(setEndDate)}
                    onReset={resetFilters}
                />
            </div>

            {/* ── Content ─────────────────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto px-4 sm:px-6 pb-6 min-h-0">
                {error ? (
                    <div className="flex flex-col items-center gap-3 py-16 text-center">
                        <div className="w-12 h-12 rounded-full bg-[var(--red-glow)] flex items-center justify-center">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="1.5">
                                <circle cx="12" cy="12" r="10" />
                                <line x1="12" y1="8" x2="12" y2="12" />
                                <line x1="12" y1="16" x2="12.01" y2="16" />
                            </svg>
                        </div>
                        <p className="text-sm text-[var(--text-secondary)]">{error}</p>
                        <button
                            onClick={() => fetchLogs({ search, action, entityType, startDate, endDate, page })}
                            className="text-xs text-[var(--red)] hover:underline focus-visible:outline-none focus-visible:underline"
                        >
                            Retry
                        </button>
                    </div>
                ) : (
                    <>
                        {/* Desktop table */}
                        <div className="hidden sm:block">
                            <table className="w-full border-collapse">
                                <thead>
                                    <tr className="border-b border-[var(--border)]">
                                        {TABLE_HEADERS.map((h) => (
                                            <th
                                                key={h}
                                                className={`px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] ${h === "IP" ? "hidden lg:table-cell" : ""}`}
                                            >
                                                {h}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {loading
                                        ? Array.from({ length: 12 }).map((_, i) => <AuditSkeletonRow key={i} />)
                                        : logs.length === 0
                                            ? (
                                                <tr>
                                                    <td colSpan={6} className="py-0">
                                                        <AuditEmptyState filtered={isFiltered} />
                                                    </td>
                                                </tr>
                                            )
                                            : logs.map((log) => (
                                                <AuditLogRow
                                                    key={log.id}
                                                    log={log}
                                                    expanded={expandedId === log.id}
                                                    onExpand={(l) =>
                                                        setExpandedId((prev) => (prev === l.id ? null : l.id))
                                                    }
                                                />
                                            ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Mobile cards */}
                        <div className="sm:hidden space-y-3 pt-2">
                            {loading
                                ? Array.from({ length: 8 }).map((_, i) => <AuditSkeletonCard key={i} />)
                                : logs.length === 0
                                    ? <AuditEmptyState filtered={isFiltered} />
                                    : logs.map((log) => <AuditLogCard key={log.id} log={log} />)}
                        </div>

                        {/* Pagination */}
                        {!loading && meta.totalPages > 1 && (
                            <div className="flex items-center justify-between mt-4 pt-4 border-t border-[var(--border)]">
                                <p className="text-xs text-[var(--text-muted)]">
                                    {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, meta.total)} of{" "}
                                    {meta.total.toLocaleString()}
                                </p>
                                <div className="flex items-center gap-1">
                                    <PaginationButton
                                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                                        disabled={page <= 1}
                                        aria-label="Previous page"
                                    >
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                            <polyline points="15 18 9 12 15 6" />
                                        </svg>
                                    </PaginationButton>

                                    {buildPageNumbers(page, meta.totalPages).map((pg, i) =>
                                        pg === null ? (
                                            <span key={`ellipsis-${i}`} className="w-8 h-8 flex items-center justify-center text-xs text-[var(--text-muted)]">
                                                ···
                                            </span>
                                        ) : (
                                            <PaginationButton
                                                key={pg}
                                                onClick={() => setPage(pg)}
                                                active={page === pg}
                                            >
                                                {pg}
                                            </PaginationButton>
                                        )
                                    )}

                                    <PaginationButton
                                        onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
                                        disabled={page >= meta.totalPages}
                                        aria-label="Next page"
                                    >
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                            <polyline points="9 18 15 12 9 6" />
                                        </svg>
                                    </PaginationButton>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

// ── Helper components ──────────────────────────────────────────────────────

function PaginationButton({
    children,
    onClick,
    disabled,
    active,
    "aria-label": ariaLabel,
}: {
    children: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
    active?: boolean;
    "aria-label"?: string;
}) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            aria-label={ariaLabel}
            className={[
                "w-8 h-8 rounded-lg text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] flex items-center justify-center",
                active
                    ? "bg-[var(--red-glow)] text-[var(--red)] border border-[var(--border-red)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] border border-transparent",
                disabled ? "opacity-30 cursor-not-allowed" : "",
            ].join(" ")}
        >
            {children}
        </button>
    );
}

function buildPageNumbers(current: number, total: number): (number | null)[] {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const pages: (number | null)[] = [1];
    if (current > 4) pages.push(null);
    const lo = Math.max(2, current - 2);
    const hi = Math.min(total - 1, current + 2);
    for (let i = lo; i <= hi; i++) pages.push(i);
    if (current < total - 3) pages.push(null);
    pages.push(total);
    return pages;
}