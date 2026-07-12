"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";

interface User {
    firstName: string;
    lastName: string;
    role: string;
}

interface NavItem {
    href: string;
    label: string;
    icon: React.ReactNode;
    badge?: number;
    roles?: Array<"ADMIN" | "OPERATOR" | "REVIEWER">;
}

const NAV_ITEMS: NavItem[] = [
    {
        href: "/dashboard",
        label: "Dashboard",
        icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
        ),
    },
    {
        href: "/dashboard/mailboxes",
        label: "Mailboxes",
        icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
            </svg>
        ),
    },
    {
        href: "/dashboard/research",
        label: "Research",
        icon: (
            <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
            >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
            </svg>
        ),
    },
    {
        href: "/dashboard/linkedin-accounts",
        label: "LinkedIn",
        icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
                <rect x="2" y="9" width="4" height="12" />
                <circle cx="4" cy="4" r="2" />
            </svg>
        ),
        roles: ["ADMIN", "OPERATOR"],
    },
    {
        href: "/dashboard/campaigns",
        label: "Campaigns",
        icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                <rect x="9" y="3" width="6" height="4" rx="1" />
                <path d="M9 12h6M9 16h4" />
            </svg>
        ),
        roles: ["ADMIN", "OPERATOR"],
    },
    {
        href: "/dashboard/leads",
        label: "Leads",
        icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
        ),
        roles: ["ADMIN", "OPERATOR"],
    },
    {
        href: "/dashboard/messages",
        label: "Messages",
        icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
        ),
    },
    {
        href: "/dashboard/replies",
        label: "Replies",
        icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="9 17 4 12 9 7" />
                <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
            </svg>
        ),
    },
    {
        href: "/dashboard/domains",
        label: "Sender Domains",
        icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
        ),
        roles: ["ADMIN", "OPERATOR"],
    },
    {
        href: "/dashboard/suppression",
        label: "Suppression",
        icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
        ),
        roles: ["ADMIN", "OPERATOR"],
    },
    {
        href: "/dashboard/audit-logs",
        label: "Audit Log",
        icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
            </svg>
        ),
        roles: ["ADMIN"],
    },
    {
        href: "/dashboard/memory",
        label: "AI Memory",
        icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 2a4 4 0 0 1 4 4v1h1a3 3 0 0 1 0 6h-1v1a4 4 0 0 1-8 0v-1H7a3 3 0 0 1 0-6h1V6a4 4 0 0 1 4-4z" />
                <circle cx="12" cy="12" r="1.5" />
            </svg>
        ),
        roles: ["ADMIN"],
    },
    { href: "/dashboard/admin", label: "Admin", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>, roles: ["ADMIN"] }
];

const BOTTOM_ITEMS: NavItem[] = [
    {
        href: "/dashboard/settings",
        label: "Settings",
        icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14" />
            </svg>
        ),
    },
    {
        href: "/dashboard/users",
        label: "Users",
        icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
        ),
        roles: ["ADMIN"],
    },
    {
        href: "/dashboard/ai-traces",
        label: "AI Traces",
        icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
        ),
        roles: ["ADMIN"],
    },
    {
        href: "/dashboard/learning",
        label: "Learning",
        icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
        ),
        roles: ["ADMIN"],
    },
    {
        href: "/dashboard/brand",
        label: "Brand Settings",
        icon: (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="13.5" cy="6.5" r="0.5" fill="currentColor" />
                <circle cx="17.5" cy="10.5" r="0.5" fill="currentColor" />
                <circle cx="8.5" cy="7.5" r="0.5" fill="currentColor" />
                <circle cx="6.5" cy="12.5" r="0.5" fill="currentColor" />
                <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
            </svg>
        ),
    },
];

interface SidebarProps {
    collapsed?: boolean;
    onToggle?: () => void;
}

function NavLink({
    item,
    active,
    collapsed,
}: {
    item: NavItem;
    active: boolean;
    collapsed: boolean;
}) {
    return (
        <Link
            href={item.href}
            aria-current={active ? "page" : undefined}
            aria-label={collapsed ? `${item.label}${item.badge ? ` (${item.badge})` : ""}` : undefined}
            title={collapsed ? item.label : undefined}
            className={[
                "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--navy-mid)]",
                active
                    ? "bg-[var(--red-glow)] text-[var(--red)] font-medium"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)]",
            ].join(" ")}
        >
            {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-[var(--red)] rounded-r-full" aria-hidden="true" />
            )}

            <span className="flex-shrink-0">{item.icon}</span>

            {!collapsed && (
                <>
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.badge != null && item.badge > 0 && (
                        <span
                            className="flex-shrink-0 text-xs font-semibold bg-[var(--red)] text-white rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 tabular-nums"
                            aria-label={`${item.badge} pending`}
                        >
                            {item.badge > 99 ? "99+" : item.badge}
                        </span>
                    )}
                </>
            )}

            {collapsed && item.badge != null && item.badge > 0 && (
                <span
                    className="absolute -top-1 -right-1 text-[10px] font-bold bg-[var(--red)] text-white rounded-full w-4 h-4 flex items-center justify-center"
                    aria-label={`${item.badge} pending`}
                >
                    {item.badge > 9 ? "9+" : item.badge}
                </span>
            )}
        </Link>
    );
}

export function Sidebar({ collapsed = false, onToggle }: SidebarProps) {
    const pathname = usePathname();
    const router = useRouter();
    const [user, setUser] = useState<User | null>(null);
    const [badges, setBadges] = useState<{ messages: number; replies: number }>({
        messages: 0,
        replies: 0,
    });

    useEffect(() => {
        fetch("/api/auth/me")
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => { if (data) setUser(data); })
            .catch(() => { });
    }, []);

    useEffect(() => {
        let retryDelay = 5_000;
        let timerId: ReturnType<typeof setTimeout>;

        async function fetchBadges() {
            try {
                const [msgRes, repRes] = await Promise.all([
                    fetch("/api/outreach-messages?approvalStatus=PENDING&limit=1"),
                    fetch("/api/replies?requiresHumanReview=true&limit=1"),
                ]);
                const [msg, rep] = await Promise.all([
                    msgRes.ok ? msgRes.json() : null,
                    repRes.ok ? repRes.json() : null,
                ]);
                setBadges({
                    messages: msg?.meta?.total ?? 0,
                    replies: rep?.meta?.total ?? 0,
                });
                retryDelay = 300_000;
            } catch {
                retryDelay = Math.min(retryDelay * 2, 60_000);
            } finally {
                timerId = setTimeout(fetchBadges, retryDelay);
            }
        }

        fetchBadges();
        return () => clearTimeout(timerId);
    }, []);

    async function handleLogout() {
        try {
            await fetch("/api/auth/logout", { method: "POST" });
        } finally {
            router.push("/auth/login");
        }
    }

    const initials = user
        ? `${user.firstName[0]}${user.lastName[0]}`.toUpperCase()
        : "··";

    const isActive = (href: string) =>
        href === "/dashboard" ? pathname === href : pathname.startsWith(href);

    return (
        <aside
            className={[
                "flex flex-col h-full bg-[var(--navy-mid)] border-r border-[var(--border)]",
                "transition-[width] duration-200 ease-in-out",
                collapsed ? "w-[60px]" : "w-[220px]",
            ].join(" ")}
            aria-label="Sidebar"
        >
            <div
                className={[
                    "flex items-center h-16 border-b border-[var(--border)] flex-shrink-0",
                    collapsed ? "justify-center px-0" : "gap-3 px-5",
                ].join(" ")}
                aria-hidden="true"
            >
                <div className="relative w-8 h-8 flex-shrink-0">
                    <div className="absolute inset-0 rounded-full border border-[var(--red)]/30" />
                    <div className="absolute inset-1 rounded-full border border-[var(--red)]/20" />
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-2 h-2 rounded-full bg-[var(--red)]" />
                    </div>
                    <div className="absolute inset-0 rounded-full overflow-hidden animate-spin" style={{ animationDuration: "6s" }}>
                        <div
                            style={{
                                position: "absolute",
                                top: "50%",
                                left: "50%",
                                width: "50%",
                                height: "50%",
                                transformOrigin: "0 0",
                                background: "conic-gradient(from 0deg, transparent 0deg, rgba(233,69,96,0.4) 45deg, transparent 45deg)",
                            }}
                        />
                    </div>
                </div>

                {!collapsed && (
                    <span className="font-display font-bold text-base text-[var(--text-primary)] tracking-tight">
                        Scout<span className="text-[var(--red)]">Send</span>
                    </span>
                )}
            </div>

            <button
                onClick={onToggle}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                aria-expanded={!collapsed}
                aria-controls="sidebar-nav"
                className={[
                    "flex items-center justify-center w-6 h-6 rounded-full",
                    "bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-secondary)]",
                    "hover:text-[var(--text-primary)] hover:border-[var(--border-red)]",
                    "absolute -right-3 top-[52px] z-10 transition-colors duration-150",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]",
                ].join(" ")}
            >
                <svg
                    width="10" height="10" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="2.5"
                    strokeLinecap="round" strokeLinejoin="round"
                    className={`transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`}
                    aria-hidden="true"
                >
                    <polyline points="15 18 9 12 15 6" />
                </svg>
            </button>

            <nav
                id="sidebar-nav"
                className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4 space-y-0.5"
                aria-label="Main navigation"
            >
                {NAV_ITEMS
                    .filter((item) => !item.roles || !user || item.roles.includes(user.role as "ADMIN" | "OPERATOR" | "REVIEWER"))
                    .map((item) => {
                        const liveBadge =
                            item.href === "/dashboard/messages" ? badges.messages :
                                item.href === "/dashboard/replies" ? badges.replies :
                                    item.badge;
                        return (
                            <NavLink
                                key={item.href}
                                item={{ ...item, badge: liveBadge }}
                                active={isActive(item.href)}
                                collapsed={collapsed}
                            />
                        );
                    })}
            </nav>

            <div className="mx-3 border-t border-[var(--border)]" aria-hidden="true" />

            <nav className="px-3 py-4 space-y-0.5" aria-label="Settings">
                {BOTTOM_ITEMS
                    .filter((item) => !item.roles || !user || item.roles.includes(user.role as "ADMIN" | "OPERATOR" | "REVIEWER"))
                    .map((item) => (
                        <NavLink
                            key={item.href}
                            item={item}
                            active={isActive(item.href)}
                            collapsed={collapsed}
                        />
                    ))}
            </nav>

            <div className={[
                "flex items-center gap-3 px-3 py-4 border-t border-[var(--border)]",
                collapsed ? "flex-col" : "",
            ].join(" ")}>
                <Link
                    href="/dashboard/settings"
                    aria-label={user ? `Account settings for ${user.firstName} ${user.lastName}` : "Account settings"}
                    title="Account settings"
                    className="w-8 h-8 rounded-full bg-gradient-to-br from-[var(--red)] to-[var(--navy-deep)] flex items-center justify-center text-xs font-bold text-white flex-shrink-0 hover:ring-2 hover:ring-[var(--red)]/40 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                >
                    {initials}
                </Link>
                {!collapsed && (
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--text-primary)] truncate leading-none mb-0.5">
                            {user ? `${user.firstName} ${user.lastName}` : ""}
                        </p>
                        <p className="text-xs text-[var(--text-muted)] truncate">
                            {user?.role ? user.role.charAt(0) + user.role.slice(1).toLowerCase() : ""}
                        </p>
                    </div>
                )}
                <button
                    onClick={handleLogout}
                    aria-label="Log out"
                    title="Log out"
                    className="flex-shrink-0 p-1.5 rounded-md text-[var(--text-secondary)] hover:text-[var(--red)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <polyline points="16 17 21 12 16 7" />
                        <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                </button>
            </div>
        </aside>
    );
}