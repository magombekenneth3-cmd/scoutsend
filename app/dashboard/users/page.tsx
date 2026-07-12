"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { TopBar } from "@/app/components/dashboard/TopBar";

type UserRole = "ADMIN" | "OPERATOR" | "REVIEWER";

interface AppUser {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: UserRole;
    createdAt: string;
    updatedAt: string;
}

interface UsersResponse {
    data: AppUser[];
    meta: { total: number; page: number; limit: number; totalPages: number };
}

interface UserStats {
    total: number;
    admins: number;
    operators: number;
    reviewers: number;
}

const PAGE_SIZE = 25;
const ALL_ROLES: UserRole[] = ["ADMIN", "OPERATOR", "REVIEWER"];

const ROLE_BADGE: Record<UserRole, string> = {
    ADMIN: "text-[var(--red)] bg-[var(--red-glow)] border border-[var(--border-red)]",
    OPERATOR: "text-sky-400 bg-sky-400/10 border border-sky-400/20",
    REVIEWER: "text-amber-400 bg-amber-400/10 border border-amber-400/20",
};

const ROLE_SELECT_OPTION_STYLE: Record<UserRole, string> = {
    ADMIN: "text-[var(--red)]",
    OPERATOR: "text-sky-400",
    REVIEWER: "text-amber-400",
};

function RoleBadge({ role }: { role: UserRole }) {
    return (
        <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold tracking-wide ${ROLE_BADGE[role]}`}
        >
            {role.charAt(0) + role.slice(1).toLowerCase()}
        </span>
    );
}

function UserAvatar({ firstName, lastName }: { firstName: string; lastName: string }) {
    const initials = `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase();
    return (
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[var(--red)] to-[var(--navy-deep)] flex-shrink-0 flex items-center justify-center text-xs font-bold text-white select-none">
            {initials}
        </div>
    );
}

function SkeletonRow() {
    return (
        <tr className="border-b border-[var(--border)]">
            {[140, 180, 90, 80, 64].map((w, i) => (
                <td key={i} className="px-4 py-3.5">
                    <div
                        className="h-3 rounded bg-[var(--surface-2)] animate-pulse"
                        style={{ width: w }}
                    />
                </td>
            ))}
        </tr>
    );
}

function SkeletonCard() {
    return (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-[var(--surface-2)] animate-pulse flex-shrink-0" />
                <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-28 rounded bg-[var(--surface-2)] animate-pulse" />
                    <div className="h-2.5 w-40 rounded bg-[var(--surface-2)] animate-pulse" />
                </div>
                <div className="h-5 w-16 rounded-full bg-[var(--surface-2)] animate-pulse" />
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-[var(--border)]">
                <div className="h-2.5 w-24 rounded bg-[var(--surface-2)] animate-pulse" />
                <div className="h-7 w-28 rounded-lg bg-[var(--surface-2)] animate-pulse" />
            </div>
        </div>
    );
}

function StatCard({
    label,
    value,
    accent,
    loading,
}: {
    label: string;
    value: number;
    accent?: string;
    loading: boolean;
}) {
    return (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex flex-col gap-1">
            <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">{label}</p>
            {loading ? (
                <div className="mt-1 h-7 w-14 rounded bg-[var(--surface-2)] animate-pulse" />
            ) : (
                <p className={`text-2xl font-bold font-display ${accent ?? "text-[var(--text-primary)]"}`}>
                    {value.toLocaleString()}
                </p>
            )}
        </div>
    );
}

function ConfirmDialog({
    title,
    message,
    confirmLabel,
    danger,
    loading,
    onConfirm,
    onCancel,
}: {
    title: string;
    message: string;
    confirmLabel: string;
    danger?: boolean;
    loading: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-fade-up">
                <h3 className="text-base font-semibold font-display text-[var(--text-primary)]">{title}</h3>
                <p className="mt-2 text-sm text-[var(--text-secondary)] leading-relaxed">{message}</p>
                <div className="mt-5 flex gap-2 justify-end">
                    <button
                        onClick={onCancel}
                        disabled={loading}
                        className="h-8 px-4 rounded-lg text-xs font-medium bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[rgba(255,255,255,0.2)] transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={loading}
                        className={`h-8 px-4 rounded-lg text-xs font-semibold transition-all disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] ${danger
                                ? "bg-[var(--red)] text-white hover:bg-[var(--red-dim)]"
                                : "bg-[var(--red)] text-white hover:bg-[var(--red-dim)]"
                            }`}
                    >
                        {loading ? (
                            <span className="flex items-center gap-1.5">
                                <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                                </svg>
                                {confirmLabel}
                            </span>
                        ) : confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function UsersPage() {
    const [users, setUsers] = useState<AppUser[]>([]);
    const [meta, setMeta] = useState({ total: 0, page: 1, limit: PAGE_SIZE, totalPages: 1 });
    const [stats, setStats] = useState<UserStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [statsLoading, setStatsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [roleFilter, setRoleFilter] = useState<UserRole | "ALL">("ALL");
    const [page, setPage] = useState(1);
    const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [confirmDialog, setConfirmDialog] = useState<{
        type: "forceLogout";
        user: AppUser;
    } | null>(null);

    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        fetch("/api/auth/me")
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (d) setCurrentUserId(d.id); })
            .catch(() => { });
    }, []);

    const fetchStats = useCallback(async () => {
        setStatsLoading(true);
        try {
            const res = await fetch("/api/users/stats");
            if (res.ok) setStats(await res.json());
        } finally {
            setStatsLoading(false);
        }
    }, []);

    const fetchUsers = useCallback(async (opts: { search: string; role: string; page: number }) => {
        setLoading(true);
        setError(null);
        const p = new URLSearchParams();
        p.set("page", String(opts.page));
        p.set("limit", String(PAGE_SIZE));
        if (opts.role !== "ALL") p.set("role", opts.role);
        if (opts.search.trim()) p.set("search", opts.search.trim());
        try {
            const res = await fetch(`/api/users?${p}`);
            if (!res.ok) throw new Error(`Server error ${res.status}`);
            const json: UsersResponse = await res.json();
            setUsers(json.data);
            setMeta(json.meta);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchStats(); }, [fetchStats]);

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            fetchUsers({ search, role: roleFilter, page });
        }, search ? 300 : 0);
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [search, roleFilter, page, fetchUsers]);

    function refresh() {
        fetchUsers({ search, role: roleFilter, page });
        fetchStats();
    }

    function changeRoleFilter(r: UserRole | "ALL") {
        setRoleFilter(r);
        setPage(1);
    }

    function changeSearch(val: string) {
        setSearch(val);
        setPage(1);
    }

    async function handleRoleChange(user: AppUser, newRole: UserRole) {
        if (newRole === user.role) return;
        setActionLoading((p) => ({ ...p, [user.id]: true }));
        setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, role: newRole } : u)));
        try {
            const res = await fetch(`/api/users/${user.id}/role`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ role: newRole }),
            });
            if (!res.ok) throw new Error("Failed");
            const updated: AppUser = await res.json();
            setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
            fetchStats();
        } catch {
            setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, role: user.role } : u)));
        } finally {
            setActionLoading((p) => ({ ...p, [user.id]: false }));
        }
    }

    async function confirmForceLogout() {
        if (!confirmDialog) return;
        const { user } = confirmDialog;
        setActionLoading((p) => ({ ...p, [user.id]: true }));
        try {
            await fetch(`/api/users/${user.id}/force-logout`, { method: "POST" });
        } finally {
            setActionLoading((p) => ({ ...p, [user.id]: false }));
            setConfirmDialog(null);
        }
    }

    function formatDate(iso: string) {
        return new Date(iso).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
        });
    }

    const isMe = (id: string) => id === currentUserId;

    const FILTER_TABS = [
        { value: "ALL" as const, label: "All", count: stats?.total },
        { value: "ADMIN" as const, label: "Admins", count: stats?.admins },
        { value: "OPERATOR" as const, label: "Operators", count: stats?.operators },
        { value: "REVIEWER" as const, label: "Reviewers", count: stats?.reviewers },
    ];

    const selectStyle =
        "h-8 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg text-xs px-2 pr-7 appearance-none focus:outline-none focus:border-[var(--border-red)] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";
    const selectArrow = {
        backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%238892b0' stroke-width='2.5' stroke-linecap='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 7px center",
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <TopBar
                title="Users"
                subtitle={
                    statsLoading
                        ? "Loading…"
                        : `${stats?.total ?? 0} user${(stats?.total ?? 0) !== 1 ? "s" : ""}`
                }
                actions={
                    <button
                        onClick={refresh}
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

            <div className="px-4 sm:px-6 py-4 grid grid-cols-2 sm:grid-cols-4 gap-3 flex-shrink-0">
                <StatCard label="Total" value={stats?.total ?? 0} loading={statsLoading} />
                <StatCard
                    label="Admins"
                    value={stats?.admins ?? 0}
                    accent="text-[var(--red)]"
                    loading={statsLoading}
                />
                <StatCard
                    label="Operators"
                    value={stats?.operators ?? 0}
                    accent="text-sky-400"
                    loading={statsLoading}
                />
                <StatCard
                    label="Reviewers"
                    value={stats?.reviewers ?? 0}
                    accent="text-amber-400"
                    loading={statsLoading}
                />
            </div>

            <div className="px-4 sm:px-6 pb-3 flex flex-col sm:flex-row sm:items-center gap-3 flex-shrink-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                    {FILTER_TABS.map((tab) => (
                        <button
                            key={tab.value}
                            onClick={() => changeRoleFilter(tab.value)}
                            className={[
                                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]",
                                roleFilter === tab.value
                                    ? "bg-[var(--red-glow)] text-[var(--red)] border border-[var(--border-red)]"
                                    : "bg-[var(--surface)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-red)]",
                            ].join(" ")}
                        >
                            {tab.label}
                            {tab.count != null && (
                                <span className="tabular-nums opacity-70">{tab.count}</span>
                            )}
                        </button>
                    ))}
                </div>

                <div className="flex items-center gap-2 sm:ml-auto">
                    <div className="relative flex-1 sm:flex-none">
                        <svg
                            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none"
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                        >
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => changeSearch(e.target.value)}
                            placeholder="Search name or email…"
                            className="w-full sm:w-52 h-8 pl-8 pr-3 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-red)] transition-colors"
                        />
                    </div>
                </div>
            </div>

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
                            onClick={refresh}
                            className="text-xs text-[var(--red)] hover:underline focus-visible:outline-none focus-visible:underline"
                        >
                            Retry
                        </button>
                    </div>
                ) : (
                    <>
                        <div className="hidden sm:block">
                            <table className="w-full border-collapse">
                                <thead>
                                    <tr className="border-b border-[var(--border)]">
                                        {["User", "Role", "Joined", ""].map((h) => (
                                            <th
                                                key={h}
                                                className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]"
                                            >
                                                {h}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {loading
                                        ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
                                        : users.length === 0
                                            ? (
                                                <tr>
                                                    <td colSpan={4} className="py-16 text-center">
                                                        <EmptyState search={search} roleFilter={roleFilter} />
                                                    </td>
                                                </tr>
                                            )
                                            : users.map((user) => (
                                                <tr
                                                    key={user.id}
                                                    className="border-b border-[var(--border)] hover:bg-[var(--surface-2)]/40 transition-colors group"
                                                >
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-3">
                                                            <UserAvatar firstName={user.firstName} lastName={user.lastName} />
                                                            <div className="min-w-0">
                                                                <p className="text-sm font-medium text-[var(--text-primary)] leading-none truncate">
                                                                    {user.firstName} {user.lastName}
                                                                    {isMe(user.id) && (
                                                                        <span className="ml-1.5 text-[10px] text-[var(--text-muted)]">(you)</span>
                                                                    )}
                                                                </p>
                                                                <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">{user.email}</p>
                                                            </div>
                                                        </div>
                                                    </td>

                                                    <td className="px-4 py-3">
                                                        {isMe(user.id) ? (
                                                            <RoleBadge role={user.role} />
                                                        ) : (
                                                            <select
                                                                value={user.role}
                                                                onChange={(e) => handleRoleChange(user, e.target.value as UserRole)}
                                                                disabled={actionLoading[user.id]}
                                                                className={`${selectStyle} ${ROLE_SELECT_OPTION_STYLE[user.role]} font-semibold`}
                                                                style={selectArrow}
                                                            >
                                                                {ALL_ROLES.map((r) => (
                                                                    <option key={r} value={r}>
                                                                        {r.charAt(0) + r.slice(1).toLowerCase()}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                        )}
                                                    </td>

                                                    <td className="px-4 py-3">
                                                        <span className="text-xs text-[var(--text-muted)]">
                                                            {formatDate(user.createdAt)}
                                                        </span>
                                                    </td>

                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            {!isMe(user.id) && (
                                                                <button
                                                                    onClick={() => setConfirmDialog({ type: "forceLogout", user })}
                                                                    disabled={actionLoading[user.id]}
                                                                    title="Force logout all sessions"
                                                                    className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[10px] font-medium text-[var(--text-secondary)] hover:text-amber-400 hover:bg-amber-400/10 border border-transparent hover:border-amber-400/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                                                                >
                                                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                                                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                                                                        <polyline points="16 17 21 12 16 7" />
                                                                        <line x1="21" y1="12" x2="9" y2="12" />
                                                                    </svg>
                                                                    Force Logout
                                                                </button>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="sm:hidden space-y-3">
                            {loading
                                ? Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
                                : users.length === 0
                                    ? <EmptyState search={search} roleFilter={roleFilter} />
                                    : users.map((user) => (
                                        <div
                                            key={user.id}
                                            className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4"
                                        >
                                            <div className="flex items-center gap-3">
                                                <UserAvatar firstName={user.firstName} lastName={user.lastName} />
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                        <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                                                            {user.firstName} {user.lastName}
                                                        </p>
                                                        {isMe(user.id) && (
                                                            <span className="text-[10px] text-[var(--text-muted)]">(you)</span>
                                                        )}
                                                    </div>
                                                    <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">{user.email}</p>
                                                </div>
                                                <RoleBadge role={user.role} />
                                            </div>

                                            <div className="mt-3 pt-3 border-t border-[var(--border)] flex items-center gap-2 flex-wrap">
                                                <span className="text-xs text-[var(--text-muted)] flex-1">
                                                    Joined {formatDate(user.createdAt)}
                                                </span>

                                                {!isMe(user.id) && (
                                                    <>
                                                        <select
                                                            value={user.role}
                                                            onChange={(e) => handleRoleChange(user, e.target.value as UserRole)}
                                                            disabled={actionLoading[user.id]}
                                                            className={`${selectStyle} ${ROLE_SELECT_OPTION_STYLE[user.role]} font-semibold`}
                                                            style={selectArrow}
                                                        >
                                                            {ALL_ROLES.map((r) => (
                                                                <option key={r} value={r}>
                                                                    {r.charAt(0) + r.slice(1).toLowerCase()}
                                                                </option>
                                                            ))}
                                                        </select>

                                                        <button
                                                            onClick={() => setConfirmDialog({ type: "forceLogout", user })}
                                                            disabled={actionLoading[user.id]}
                                                            className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[10px] font-medium text-[var(--text-secondary)] hover:text-amber-400 hover:bg-amber-400/10 border border-[var(--border)] hover:border-amber-400/20 transition-all disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                                                        >
                                                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                                                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                                                                <polyline points="16 17 21 12 16 7" />
                                                                <line x1="21" y1="12" x2="9" y2="12" />
                                                            </svg>
                                                            Logout
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                        </div>

                        {!loading && meta.totalPages > 1 && (
                            <div className="flex items-center justify-between mt-4 pt-4 border-t border-[var(--border)]">
                                <p className="text-xs text-[var(--text-muted)]">
                                    {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, meta.total)} of {meta.total.toLocaleString()}
                                </p>
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                                        disabled={page <= 1}
                                        className="flex items-center justify-center w-8 h-8 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-red)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                                    >
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                            <polyline points="15 18 9 12 15 6" />
                                        </svg>
                                    </button>

                                    {Array.from({ length: Math.min(meta.totalPages, 7) }).map((_, i) => {
                                        const tp = meta.totalPages;
                                        let pg: number | null;
                                        if (tp <= 7) {
                                            pg = i + 1;
                                        } else if (i === 0) {
                                            pg = 1;
                                        } else if (i === 6) {
                                            pg = tp;
                                        } else if (page <= 4) {
                                            pg = i + 1;
                                        } else if (page >= tp - 3) {
                                            pg = tp - 6 + i;
                                        } else {
                                            pg = i === 1 || i === 5 ? null : page - 2 + (i - 2);
                                        }

                                        if (pg === null) {
                                            return (
                                                <span key={i} className="w-8 h-8 flex items-center justify-center text-xs text-[var(--text-muted)]">
                                                    ···
                                                </span>
                                            );
                                        }

                                        return (
                                            <button
                                                key={i}
                                                onClick={() => setPage(pg!)}
                                                className={[
                                                    "w-8 h-8 rounded-lg text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]",
                                                    page === pg
                                                        ? "bg-[var(--red-glow)] text-[var(--red)] border border-[var(--border-red)]"
                                                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] border border-transparent",
                                                ].join(" ")}
                                            >
                                                {pg}
                                            </button>
                                        );
                                    })}

                                    <button
                                        onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
                                        disabled={page >= meta.totalPages}
                                        className="flex items-center justify-center w-8 h-8 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-red)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                                    >
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                            <polyline points="9 18 15 12 9 6" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {confirmDialog && (
                <ConfirmDialog
                    title="Force Logout"
                    message={`Sign out all active sessions for ${confirmDialog.user.firstName} ${confirmDialog.user.lastName}? Their JWT will be invalidated immediately.`}
                    confirmLabel="Force Logout"
                    danger
                    loading={actionLoading[confirmDialog.user.id] ?? false}
                    onConfirm={confirmForceLogout}
                    onCancel={() => setConfirmDialog(null)}
                />
            )}
        </div>
    );
}

function EmptyState({
    search,
    roleFilter,
}: {
    search: string;
    roleFilter: UserRole | "ALL";
}) {
    const filtered = search || roleFilter !== "ALL";
    return (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <div className="w-14 h-14 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-[var(--text-muted)]">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
            </div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">
                {filtered ? "No users match this filter" : "No users found"}
            </p>
            <p className="text-xs text-[var(--text-muted)] max-w-[220px]">
                {filtered ? "Try adjusting your search or filter." : "Users will appear here once registered."}
            </p>
        </div>
    );
}