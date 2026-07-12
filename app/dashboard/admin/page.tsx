"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { TopBar } from "@/app/components/dashboard/TopBar";

type Tab = "overview" | "users" | "system";
type UserRole = "ADMIN" | "OPERATOR" | "REVIEWER";
type PageState = "loading" | "forbidden" | "error" | "ready";

interface CurrentUser {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
}

interface PlatformStats {
    users: {
        total: number;
        admins: number;
        operators: number;
        reviewers: number;
        last7Days: number;
    };
    campaigns: { total: number; active: number; completed: number; failed: number };
    leads: { total: number; last7Days: number };
    messages: { total: number; sent: number; pending: number };
    mailboxes: { total: number };
    domains: { total: number; healthy: number };
    replies: { total: number; positive: number };
}

interface QueueSnapshot {
    name: string;
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
    completed: number;
}

interface SystemHealth {
    db: { ok: boolean; latencyMs: number };
    redis: { ok: boolean; latencyMs: number; memoryMb: number | null };
    queues: QueueSnapshot[];
    uptimeSeconds: number;
}

interface AdminUser {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: UserRole;
    createdAt: string;
}

interface UserListMeta {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

const PAGE_SIZE = 25;
const ROLES: UserRole[] = ["ADMIN", "OPERATOR", "REVIEWER"];

function formatUptime(seconds: number): string {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

function StatusDot({ ok }: { ok: boolean }) {
    return (
        <span
            className="inline-block w-2 h-2 rounded-full flex-shrink-0"
            style={{ background: ok ? "#1D9E75" : "var(--red)" }}
        />
    );
}

function StatCard({
    label,
    value,
    sub,
    warn,
}: {
    label: string;
    value: string | number;
    sub?: string;
    warn?: boolean;
}) {
    return (
        <div
            className="rounded-xl p-4 flex flex-col gap-1"
            style={{ background: "var(--navy-mid)", border: "1px solid var(--border)" }}
        >
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {label}
            </span>
            <span
                className="text-2xl font-semibold font-display"
                style={{ color: warn ? "var(--red)" : "var(--text-primary)" }}
            >
                {typeof value === "number" ? value.toLocaleString() : value}
            </span>
            {sub && (
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {sub}
                </span>
            )}
        </div>
    );
}

function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
    return (
        <div
            className={`rounded animate-pulse ${className ?? ""}`}
            style={{ background: "var(--surface-2)", ...style }}
        />
    );
}

function InfraTable({ health }: { health: SystemHealth }) {
    return (
        <div
            className="rounded-xl overflow-hidden"
            style={{ border: "1px solid var(--border)", background: "var(--navy-mid)" }}
        >
            <table className="w-full text-sm">
                <tbody>
                    {[
                        {
                            label: "PostgreSQL",
                            ok: health.db.ok,
                            detail: health.db.ok
                                ? `Connected · ${health.db.latencyMs}ms`
                                : "Unavailable",
                        },
                        {
                            label: "Redis",
                            ok: health.redis.ok,
                            detail: health.redis.ok
                                ? `Connected · ${health.redis.latencyMs}ms${health.redis.memoryMb != null ? ` · ${health.redis.memoryMb} MB` : ""}`
                                : "Unavailable",
                        },
                    ].map(({ label, ok, detail }, i) => (
                        <tr
                            key={label}
                            style={{ borderBottom: "1px solid var(--border)" }}
                        >
                            <td
                                className="px-4 py-3 w-36 text-xs"
                                style={{ color: "var(--text-muted)" }}
                            >
                                {label}
                            </td>
                            <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                    <StatusDot ok={ok} />
                                    <span
                                        className="text-sm"
                                        style={{ color: "var(--text-primary)" }}
                                    >
                                        {detail}
                                    </span>
                                </div>
                            </td>
                        </tr>
                    ))}
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                        <td
                            className="px-4 py-3 w-36 text-xs"
                            style={{ color: "var(--text-muted)" }}
                        >
                            Uptime
                        </td>
                        <td
                            className="px-4 py-3 text-sm font-medium"
                            style={{ color: "var(--text-primary)" }}
                        >
                            {formatUptime(health.uptimeSeconds)}
                        </td>
                    </tr>
                    {health.queues.map((q, i) => (
                        <tr
                            key={q.name}
                            style={{
                                borderBottom:
                                    i < health.queues.length - 1
                                        ? "1px solid var(--border)"
                                        : undefined,
                            }}
                        >
                            <td
                                className="px-4 py-3 text-xs font-mono"
                                style={{ color: "var(--text-muted)" }}
                            >
                                {q.name}
                            </td>
                            <td className="px-4 py-3">
                                <div className="flex items-center gap-4 text-xs">
                                    {[
                                        { k: "active", v: q.active, warn: q.active > 50 },
                                        { k: "waiting", v: q.waiting, warn: false },
                                        { k: "delayed", v: q.delayed, warn: false },
                                        { k: "failed", v: q.failed, warn: q.failed > 0 },
                                    ].map(({ k, v, warn }) => (
                                        <span key={k}>
                                            <span style={{ color: "var(--text-muted)" }}>
                                                {k}{" "}
                                            </span>
                                            <span
                                                style={{
                                                    color: warn ? "var(--red)" : "var(--text-primary)",
                                                    fontWeight: warn ? 600 : 400,
                                                }}
                                            >
                                                {v}
                                            </span>
                                        </span>
                                    ))}
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function OverviewTab({
    stats,
    health,
}: {
    stats: PlatformStats | null;
    health: SystemHealth | null;
}) {
    return (
        <div className="space-y-8">
            <section>
                <p
                    className="text-xs font-medium uppercase tracking-wider mb-3"
                    style={{ color: "var(--text-muted)" }}
                >
                    Platform
                </p>
                {stats ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <StatCard
                            label="Total users"
                            value={stats.users.total}
                            sub={`+${stats.users.last7Days} this week`}
                        />
                        <StatCard
                            label="Total leads"
                            value={stats.leads.total}
                            sub={`+${stats.leads.last7Days} this week`}
                        />
                        <StatCard
                            label="Emails sent"
                            value={stats.messages.sent}
                            sub={`${stats.messages.pending} pending`}
                        />
                        <StatCard
                            label="Campaigns"
                            value={stats.campaigns.total}
                            sub={`${stats.campaigns.active} active`}
                        />
                        <StatCard
                            label="Replies"
                            value={stats.replies.total}
                            sub={`${stats.replies.positive} positive`}
                        />
                        <StatCard label="Mailboxes" value={stats.mailboxes.total} />
                        <StatCard
                            label="Sender domains"
                            value={stats.domains.total}
                            sub={`${stats.domains.healthy} healthy`}
                            warn={stats.domains.healthy < stats.domains.total}
                        />
                        <StatCard
                            label="Role split"
                            value={`${stats.users.admins}A · ${stats.users.operators}O · ${stats.users.reviewers}R`}
                        />
                    </div>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {Array.from({ length: 8 }).map((_, i) => (
                            <Skeleton key={i} className="h-24" />
                        ))}
                    </div>
                )}
            </section>

            <section>
                <p
                    className="text-xs font-medium uppercase tracking-wider mb-3"
                    style={{ color: "var(--text-muted)" }}
                >
                    Infrastructure
                </p>
                {health ? (
                    <InfraTable health={health} />
                ) : (
                    <div className="space-y-2">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <Skeleton key={i} className="h-10" />
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}

function UsersTab({ currentUserId }: { currentUserId: string }) {
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [meta, setMeta] = useState<UserListMeta>({
        total: 0,
        page: 1,
        limit: PAGE_SIZE,
        totalPages: 1,
    });
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [roleFilter, setRoleFilter] = useState<UserRole | "">("");
    const [page, setPage] = useState(1);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const fetchUsers = useCallback(
        async (opts: { search: string; role: string; page: number }) => {
            setLoading(true);
            setError(null);
            const p = new URLSearchParams();
            p.set("page", String(opts.page));
            p.set("limit", String(PAGE_SIZE));
            if (opts.search.trim()) p.set("search", opts.search.trim());
            if (opts.role) p.set("role", opts.role);
            try {
                const res = await fetch(`/api/admin/users?${p}`, {
                    credentials: "include",
                    cache: "no-store",
                });
                if (!res.ok) throw new Error("Failed to load users");
                const json = await res.json();
                setUsers(json.data);
                setMeta(json.meta);
            } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to load users");
            } finally {
                setLoading(false);
            }
        },
        []
    );

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            fetchUsers({ search, role: roleFilter, page });
        }, 300);
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [search, roleFilter, page, fetchUsers]);

    async function changeRole(userId: string, role: UserRole) {
        setActionLoading(`role-${userId}`);
        setError(null);
        try {
            const res = await fetch(`/api/admin/users/${userId}/role`, {
                method: "PATCH",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ role }),
            });
            if (!res.ok) {
                const d = await res.json();
                throw new Error(d.error ?? "Failed to update role");
            }
            setUsers(prev => prev.map(u => (u.id === userId ? { ...u, role } : u)));
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to update role");
        } finally {
            setActionLoading(null);
        }
    }

    async function forceLogout(userId: string) {
        setActionLoading(`logout-${userId}`);
        setError(null);
        try {
            const res = await fetch(`/api/admin/users/${userId}/force-logout`, {
                method: "POST",
                credentials: "include",
            });
            if (!res.ok && res.status !== 204) {
                const d = await res.json();
                throw new Error(d.error ?? "Failed");
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to force logout");
        } finally {
            setActionLoading(null);
        }
    }

    async function handleDelete(userId: string) {
        if (
            !window.confirm(
                "Permanently delete this user and all their data? This cannot be undone."
            )
        )
            return;
        setActionLoading(`delete-${userId}`);
        setError(null);
        try {
            const res = await fetch(`/api/admin/users/${userId}`, {
                method: "DELETE",
                credentials: "include",
            });
            if (!res.ok && res.status !== 204) {
                const d = await res.json();
                throw new Error(d.error ?? "Failed to delete user");
            }
            setUsers(prev => prev.filter(u => u.id !== userId));
            setMeta(prev => ({ ...prev, total: prev.total - 1 }));
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to delete user");
        } finally {
            setActionLoading(null);
        }
    }

    return (
        <div className="space-y-4">
            {error && (
                <div
                    className="px-4 py-3 rounded-lg text-sm"
                    style={{
                        background: "rgba(229,72,72,0.08)",
                        color: "var(--red)",
                        border: "1px solid rgba(229,72,72,0.2)",
                    }}
                >
                    {error}
                </div>
            )}

            <div className="flex items-center gap-3 flex-wrap">
                <div className="relative flex-1 min-w-48 max-w-xs">
                    <svg
                        className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
                        style={{ color: "var(--text-muted)" }}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden="true"
                    >
                        <circle cx="11" cy="11" r="8" />
                        <path d="m21 21-4.35-4.35" />
                    </svg>
                    <input
                        type="search"
                        placeholder="Search name or email…"
                        value={search}
                        onChange={e => {
                            setSearch(e.target.value);
                            setPage(1);
                        }}
                        className="w-full pl-9 pr-3 py-2 rounded-lg text-sm outline-none"
                        style={{
                            background: "var(--navy-mid)",
                            border: "1px solid var(--border)",
                            color: "var(--text-primary)",
                        }}
                    />
                </div>
                <select
                    value={roleFilter}
                    onChange={e => {
                        setRoleFilter(e.target.value as UserRole | "");
                        setPage(1);
                    }}
                    className="px-3 py-2 rounded-lg text-sm outline-none"
                    style={{
                        background: "var(--navy-mid)",
                        border: "1px solid var(--border)",
                        color: "var(--text-primary)",
                    }}
                >
                    <option value="">All roles</option>
                    {ROLES.map(r => (
                        <option key={r} value={r}>
                            {r}
                        </option>
                    ))}
                </select>
                <span
                    className="text-xs ml-auto"
                    style={{ color: "var(--text-muted)" }}
                >
                    {meta.total.toLocaleString()} users
                </span>
            </div>

            <div
                className="rounded-xl overflow-hidden"
                style={{ border: "1px solid var(--border)", background: "var(--navy-mid)" }}
            >
                <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[640px]">
                        <thead>
                            <tr style={{ borderBottom: "1px solid var(--border)" }}>
                                {["User", "Role", "Joined", "Actions"].map(h => (
                                    <th
                                        key={h}
                                        className="px-4 py-2.5 text-left text-xs font-medium"
                                        style={{ color: "var(--text-muted)" }}
                                    >
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                Array.from({ length: 8 }).map((_, i) => (
                                    <tr
                                        key={i}
                                        style={{ borderBottom: "1px solid var(--border)" }}
                                    >
                                        <td className="px-4 py-3">
                                            <div className="space-y-1.5">
                                                <Skeleton style={{ height: 14, width: 160 }} />
                                                <Skeleton style={{ height: 12, width: 200 }} />
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <Skeleton style={{ height: 28, width: 90 }} />
                                        </td>
                                        <td className="px-4 py-3">
                                            <Skeleton style={{ height: 14, width: 80 }} />
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex gap-2">
                                                <Skeleton style={{ height: 28, width: 90 }} />
                                                <Skeleton style={{ height: 28, width: 60 }} />
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            ) : users.length === 0 ? (
                                <tr>
                                    <td
                                        colSpan={4}
                                        className="px-4 py-12 text-center text-sm"
                                        style={{ color: "var(--text-muted)" }}
                                    >
                                        No users found
                                    </td>
                                </tr>
                            ) : (
                                users.map(user => {
                                    const isSelf = user.id === currentUserId;
                                    const isActing = !!actionLoading;
                                    return (
                                        <tr
                                            key={user.id}
                                            style={{ borderBottom: "1px solid var(--border)" }}
                                        >
                                            <td className="px-4 py-3">
                                                <div
                                                    className="font-medium text-sm"
                                                    style={{ color: "var(--text-primary)" }}
                                                >
                                                    {user.firstName} {user.lastName}
                                                    {isSelf && (
                                                        <span
                                                            className="ml-2 text-xs font-normal"
                                                            style={{ color: "var(--text-muted)" }}
                                                        >
                                                            (you)
                                                        </span>
                                                    )}
                                                </div>
                                                <div
                                                    className="text-xs mt-0.5"
                                                    style={{ color: "var(--text-muted)" }}
                                                >
                                                    {user.email}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <select
                                                    value={user.role}
                                                    disabled={isSelf || actionLoading === `role-${user.id}`}
                                                    onChange={e =>
                                                        changeRole(user.id, e.target.value as UserRole)
                                                    }
                                                    className="px-2 py-1.5 rounded text-xs outline-none disabled:opacity-40 disabled:cursor-not-allowed"
                                                    style={{
                                                        background: "var(--surface-2)",
                                                        border: "1px solid var(--border)",
                                                        color: "var(--text-primary)",
                                                    }}
                                                >
                                                    {ROLES.map(r => (
                                                        <option key={r} value={r}>
                                                            {r}
                                                        </option>
                                                    ))}
                                                </select>
                                            </td>
                                            <td
                                                className="px-4 py-3 text-xs"
                                                style={{ color: "var(--text-muted)" }}
                                            >
                                                {formatDate(user.createdAt)}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        disabled={isSelf || isActing}
                                                        onClick={() => forceLogout(user.id)}
                                                        className="px-2.5 py-1.5 rounded text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                                        style={{
                                                            background: "var(--surface-2)",
                                                            border: "1px solid var(--border)",
                                                            color: "var(--text-secondary)",
                                                        }}
                                                    >
                                                        {actionLoading === `logout-${user.id}`
                                                            ? "…"
                                                            : "Force logout"}
                                                    </button>
                                                    <button
                                                        disabled={isSelf || isActing}
                                                        onClick={() => handleDelete(user.id)}
                                                        className="px-2.5 py-1.5 rounded text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                                        style={{
                                                            background: "rgba(229,72,72,0.08)",
                                                            border: "1px solid rgba(229,72,72,0.18)",
                                                            color: "var(--red)",
                                                        }}
                                                    >
                                                        {actionLoading === `delete-${user.id}`
                                                            ? "…"
                                                            : "Delete"}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {meta.totalPages > 1 && (
                <div className="flex items-center justify-between pt-1">
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                        Page {meta.page} of {meta.totalPages} · {meta.total} total
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            disabled={page <= 1}
                            onClick={() => setPage(p => p - 1)}
                            className="px-3 py-1.5 rounded text-xs disabled:opacity-40 transition-colors"
                            style={{
                                background: "var(--navy-mid)",
                                border: "1px solid var(--border)",
                                color: "var(--text-primary)",
                            }}
                        >
                            Previous
                        </button>
                        <button
                            disabled={page >= meta.totalPages}
                            onClick={() => setPage(p => p + 1)}
                            className="px-3 py-1.5 rounded text-xs disabled:opacity-40 transition-colors"
                            style={{
                                background: "var(--navy-mid)",
                                border: "1px solid var(--border)",
                                color: "var(--text-primary)",
                            }}
                        >
                            Next
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

function SystemTab({ health }: { health: SystemHealth | null }) {
    if (!health) {
        return (
            <div className="space-y-4">
                {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-36" />
                ))}
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <section>
                <p
                    className="text-xs font-medium uppercase tracking-wider mb-3"
                    style={{ color: "var(--text-muted)" }}
                >
                    Services
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {[
                        {
                            label: "PostgreSQL",
                            ok: health.db.ok,
                            detail: health.db.ok
                                ? `${health.db.latencyMs}ms round-trip`
                                : "Connection failed",
                        },
                        {
                            label: "Redis",
                            ok: health.redis.ok,
                            detail: health.redis.ok
                                ? `${health.redis.latencyMs}ms${health.redis.memoryMb != null ? ` · ${health.redis.memoryMb} MB used` : ""}`
                                : "Connection failed",
                        },
                        {
                            label: "Process uptime",
                            ok: true,
                            detail: formatUptime(health.uptimeSeconds),
                        },
                    ].map(({ label, ok, detail }) => (
                        <div
                            key={label}
                            className="rounded-xl p-4"
                            style={{
                                background: "var(--navy-mid)",
                                border: "1px solid var(--border)",
                            }}
                        >
                            <div className="flex items-center gap-2 mb-1.5">
                                <StatusDot ok={ok} />
                                <span
                                    className="text-sm font-medium"
                                    style={{ color: "var(--text-primary)" }}
                                >
                                    {label}
                                </span>
                            </div>
                            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                                {detail}
                            </p>
                        </div>
                    ))}
                </div>
            </section>

            <section>
                <p
                    className="text-xs font-medium uppercase tracking-wider mb-3"
                    style={{ color: "var(--text-muted)" }}
                >
                    BullMQ queues
                </p>
                <div className="space-y-3">
                    {health.queues.map(q => (
                        <div
                            key={q.name}
                            className="rounded-xl p-4"
                            style={{
                                background: "var(--navy-mid)",
                                border: `1px solid ${q.failed > 0 ? "rgba(229,72,72,0.3)" : "var(--border)"}`,
                            }}
                        >
                            <div className="flex items-center justify-between mb-4">
                                <span
                                    className="text-sm font-medium font-mono"
                                    style={{ color: "var(--text-primary)" }}
                                >
                                    {q.name}
                                </span>
                                {q.failed > 0 && (
                                    <span
                                        className="text-xs px-2 py-0.5 rounded font-medium"
                                        style={{
                                            background: "rgba(229,72,72,0.1)",
                                            color: "var(--red)",
                                            border: "1px solid rgba(229,72,72,0.2)",
                                        }}
                                    >
                                        {q.failed} failed
                                    </span>
                                )}
                            </div>
                            <div className="grid grid-cols-5 gap-4">
                                {[
                                    { label: "Active", value: q.active, warn: q.active > 50 },
                                    { label: "Waiting", value: q.waiting, warn: q.waiting > 200 },
                                    { label: "Delayed", value: q.delayed, warn: false },
                                    { label: "Failed", value: q.failed, warn: q.failed > 0 },
                                    { label: "Completed", value: q.completed, warn: false },
                                ].map(({ label, value, warn }) => (
                                    <div key={label}>
                                        <p
                                            className="text-xs mb-1"
                                            style={{ color: "var(--text-muted)" }}
                                        >
                                            {label}
                                        </p>
                                        <p
                                            className="text-xl font-semibold"
                                            style={{
                                                color: warn ? "var(--red)" : "var(--text-primary)",
                                            }}
                                        >
                                            {value.toLocaleString()}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
}

export default function AdminPage() {
    const [pageState, setPageState] = useState<PageState>("loading");
    const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
    const [tab, setTab] = useState<Tab>("overview");
    const [stats, setStats] = useState<PlatformStats | null>(null);
    const [health, setHealth] = useState<SystemHealth | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);
    const [refreshing, setRefreshing] = useState(false);

    useEffect(() => {
        let cancelled = false;
        async function init() {
            try {
                const res = await fetch("/api/auth/me", { credentials: "include" });
                if (res.status === 401) {
                    if (!cancelled) setPageState("forbidden");
                    return;
                }
                if (!res.ok) throw new Error("Failed to fetch user");
                const user: CurrentUser = await res.json();
                if (user.role !== "ADMIN") {
                    if (!cancelled) setPageState("forbidden");
                    return;
                }
                if (!cancelled) {
                    setCurrentUser(user);
                    setPageState("ready");
                }
            } catch {
                if (!cancelled) setPageState("error");
            }
        }
        init();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (pageState !== "ready") return;
        let cancelled = false;
        setRefreshing(true);
        Promise.all([
            fetch("/api/admin/stats", {
                credentials: "include",
                cache: "no-store",
            }).then(r => r.json() as Promise<PlatformStats>),
            fetch("/api/admin/health", {
                credentials: "include",
                cache: "no-store",
            }).then(r => r.json() as Promise<SystemHealth>),
        ])
            .then(([s, h]) => {
                if (!cancelled) {
                    setStats(s);
                    setHealth(h);
                }
            })
            .catch(() => { })
            .finally(() => {
                if (!cancelled) setRefreshing(false);
            });
        return () => {
            cancelled = true;
        };
    }, [pageState, refreshKey]);

    const breadcrumbs = [
        { label: "Dashboard", href: "/dashboard" },
        { label: "Admin", href: "/dashboard/admin" },
    ];

    if (pageState === "loading") {
        return (
            <div className="flex flex-col h-full">
                <TopBar
                    title="Admin"
                    subtitle="Loading…"
                    breadcrumbs={breadcrumbs}
                />
                <div className="flex-1 p-6 space-y-3">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <Skeleton key={i} className="h-12" />
                    ))}
                </div>
            </div>
        );
    }

    if (pageState === "forbidden") {
        return (
            <div className="flex flex-col h-full">
                <TopBar title="Admin" breadcrumbs={breadcrumbs} />
                <div className="flex-1 flex items-center justify-center">
                    <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                        You do not have permission to view this page.
                    </p>
                </div>
            </div>
        );
    }

    if (pageState === "error") {
        return (
            <div className="flex flex-col h-full">
                <TopBar title="Admin" breadcrumbs={breadcrumbs} />
                <div className="flex-1 flex items-center justify-center">
                    <p className="text-sm" style={{ color: "var(--red)" }}>
                        Failed to load admin panel. Check server logs.
                    </p>
                </div>
            </div>
        );
    }

    const TABS: { key: Tab; label: string }[] = [
        { key: "overview", label: "Overview" },
        { key: "users", label: "Users" },
        { key: "system", label: "System" },
    ];

    return (
        <div className="flex flex-col h-full min-h-0">
            <TopBar
                title="Admin"
                subtitle="Platform management"
                breadcrumbs={breadcrumbs}
                actions={
                    <button
                        onClick={() => setRefreshKey(k => k + 1)}
                        disabled={refreshing}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors disabled:opacity-50"
                        style={{
                            background: "var(--surface-2)",
                            border: "1px solid var(--border)",
                            color: "var(--text-secondary)",
                        }}
                    >
                        <svg
                            className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                        >
                            <path d="M21 2v6h-6" />
                            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                            <path d="M3 22v-6h6" />
                            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                        </svg>
                        Refresh
                    </button>
                }
            />

            <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
                <div
                    className="flex items-center gap-1 px-6 pt-4 border-b"
                    style={{ borderColor: "var(--border)" }}
                >
                    {TABS.map(t => (
                        <button
                            key={t.key}
                            onClick={() => setTab(t.key)}
                            className="px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors"
                            style={{
                                color:
                                    tab === t.key
                                        ? "var(--text-primary)"
                                        : "var(--text-muted)",
                                borderBottomColor:
                                    tab === t.key ? "#1D9E75" : "transparent",
                            }}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                <div className="flex-1 p-6">
                    {tab === "overview" && (
                        <OverviewTab stats={stats} health={health} />
                    )}
                    {tab === "users" && currentUser && (
                        <UsersTab currentUserId={currentUser.id} />
                    )}
                    {tab === "system" && <SystemTab health={health} />}
                </div>
            </div>
        </div>
    );
}