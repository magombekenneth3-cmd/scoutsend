"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useUser } from "../../context/UserContext";

interface User {
    firstName: string;
    lastName: string;
    role: string;
    emailVerified?: boolean;
}


interface NavItem {
    href: string;
    label: string;
    icon: React.ReactNode;
    badge?: number;
    roles?: Array<"ADMIN" | "OPERATOR" | "REVIEWER">;
}

interface NavSection {
    label: string;
    items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
    {
        label: "Outreach",
        items: [
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
        ],
    },
    {
        label: "Channels",
        items: [
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
                href: "/dashboard/domains",
                label: "Domains",
                icon: (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="2" y1="12" x2="22" y2="12" />
                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    </svg>
                ),
                roles: ["ADMIN", "OPERATOR"],
            },
        ],
    },
    {
        label: "Intelligence",
        items: [
            {
                href: "/dashboard/find-leads",
                label: "Find leads",
                icon: (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="11" cy="11" r="8" />
                        <path d="m21 21-4.35-4.35" />
                        <path d="M11 8v6M8 11h6" />
                    </svg>
                ),
                roles: ["ADMIN", "OPERATOR"],
            },
            {
                href: "/dashboard/research",
                label: "Research",
                icon: (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="11" cy="11" r="8" />
                        <path d="m21 21-4.35-4.35" />
                    </svg>
                ),
            },
            {
                href: "/dashboard/competitors",
                label: "Competitors",
                icon: (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                ),
                roles: ["ADMIN", "OPERATOR"],
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
        ],
    },
    {
        label: "Settings",
        items: [
            {
                href: "/dashboard/settings/profile",
                label: "Settings",
                icon: (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14" />
                    </svg>
                ),
            },
        ],
    },
];

interface SidebarProps {
    collapsed?: boolean;
    onToggle?: () => void;
    /** When provided, sidebar is in mobile drawer mode: nav clicks close the drawer, collapse toggle is hidden */
    mobileClose?: () => void;
}

function NavLink({
    item,
    active,
    collapsed,
    onNavClick,
}: {
    item: NavItem;
    active: boolean;
    collapsed: boolean;
    onNavClick?: () => void;
}) {
    return (
        <Link
            href={item.href}
            onClick={onNavClick}
            aria-current={active ? "page" : undefined}
            aria-label={collapsed ? `${item.label}${item.badge ? ` (${item.badge})` : ""}` : undefined}
            title={collapsed ? item.label : undefined}
            className={[
                "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--navy-mid)]",
                active
                    ? "text-[var(--red-text)] font-medium"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-bg-hover)]",
            ].join(" ")}
        >
            {active && (
                <motion.div
                    layoutId="sidebarActivePill"
                    className="absolute inset-0 rounded-lg bg-[var(--red-glow)] border border-[var(--border-red)]/40 -z-10"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
            )}

            <span className="flex-shrink-0">{item.icon}</span>

            {!collapsed && (
                <>
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.badge != null && item.badge > 0 && (
                        <span
                            className="flex-shrink-0 text-xs font-semibold bg-[var(--red)] text-white rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 tabular-nums animate-glow-throb"
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

export function Sidebar({ collapsed = false, onToggle, mobileClose }: SidebarProps) {
    const isMobile = !!mobileClose;
    const pathname = usePathname();
    const router = useRouter();
    const contextUser = useUser();
    const [badges, setBadges] = useState<{ messages: number; replies: number }>({ messages: 0, replies: 0 });
    const [isLight, setIsLight] = useState(false);

    const user: User | null = contextUser;

    useEffect(() => {
        setIsLight(document.documentElement.classList.contains("light"));
    }, []);

    const toggleTheme = () => {
        const nextTheme = !isLight;
        setIsLight(nextTheme);
        if (nextTheme) {
            document.documentElement.classList.add("light");
            localStorage.setItem("theme", "light");
        } else {
            document.documentElement.classList.remove("light");
            localStorage.setItem("theme", "dark");
        }
    };

    useEffect(() => {
        let timerId: ReturnType<typeof setTimeout>;
        let cancelled = false;

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
                if (!cancelled) {
                    setBadges({
                        messages: msg?.meta?.total ?? 0,
                        replies: rep?.meta?.total ?? 0,
                    });
                }
            } catch { }
            if (!cancelled) timerId = setTimeout(fetchBadges, 300_000);
        }

        if (user && user.emailVerified !== false) {
            fetchBadges();
        }

        return () => {
            cancelled = true;
            clearTimeout(timerId);
        };
    }, [user]);


    async function handleLogout() {
        try {
            await fetch("/api/auth/logout", { method: "POST" });
        } finally {
            router.push("/auth/login");
        }
    }

    const initials = user
        ? `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase() || "··"
        : "··";

    const isActive = (href: string) =>
        href === "/dashboard" ? pathname === href : pathname.startsWith(href);

    return (
        <aside
            className={[
                "flex flex-col h-full sidebar-glass border-r border-[var(--glass-border)]",
                "transition-[width] duration-300 ease-in-out",
                collapsed ? "w-[60px]" : "w-[220px]",
            ].join(" ")}
            aria-label="Sidebar"
        >
            <div
                className={[
                    "flex items-center h-14 border-b border-[var(--border)] flex-shrink-0",
                    collapsed ? "justify-center px-0" : "gap-3 px-4",
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
                                background: "conic-gradient(from 0deg, transparent 0deg, var(--red-glow) 45deg, transparent 45deg)",
                            }}
                        />
                    </div>
                </div>

                {!collapsed && (
                    <span className="font-display font-bold text-base text-[var(--text-primary)] tracking-tight flex-1">
                        Scout<span className="text-[var(--red-text)]">Send</span>
                    </span>
                )}

                {/* Close button — only shown in mobile drawer mode */}
                {isMobile && (
                    <button
                        onClick={mobileClose}
                        aria-label="Close navigation"
                        className="flex items-center justify-center w-8 h-8 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] flex-shrink-0"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                )}
            </div>

            {/* Collapse toggle — only shown on desktop, not in mobile drawer */}
            {!isMobile && (
                <button
                    onClick={onToggle}
                    aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                    aria-expanded={!collapsed}
                    aria-controls="sidebar-nav"
                    className={[
                        "interactive-spring flex items-center justify-center w-6 h-6 rounded-full",
                        "bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--text-secondary)]",
                        "hover:text-[var(--text-primary)] hover:border-[var(--border-red)] hover:bg-[var(--surface)]",
                        "absolute -right-3 top-[52px] z-10",
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
            )}

            <nav
                id="sidebar-nav"
                className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 space-y-3"
                aria-label="Main navigation"
            >
                <div className="space-y-0.5 mb-3">
                    <NavLink
                        item={{
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
                        }}
                        active={isActive("/dashboard")}
                        collapsed={collapsed}
                        onNavClick={mobileClose}
                    />
                </div>

                {!collapsed ? (
                    <div className="px-3 mb-3">
                        <Link
                            href="/dashboard/campaigns?new=true"
                            onClick={mobileClose}
                            className="flex items-center justify-center gap-2 w-full text-left px-3 py-2.5 rounded-lg text-xs font-semibold text-white bg-[var(--red)] hover:bg-[var(--red-dim)] active:scale-[0.97] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                                <line x1="12" y1="5" x2="12" y2="19" />
                                <line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                            New campaign
                        </Link>
                    </div>
                ) : (
                    <div className="flex justify-center mb-3">
                        <Link
                            href="/dashboard/campaigns?new=true"
                            onClick={mobileClose}
                            title="New campaign"
                            className="flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--red)] text-white hover:bg-[var(--red-dim)] active:scale-[0.97] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                                <line x1="12" y1="5" x2="12" y2="19" />
                                <line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                        </Link>
                    </div>
                )}

                {NAV_SECTIONS.map((section, index) => {
                    const visibleItems = section.items.filter(
                        (item) => !item.roles || !user || item.roles.includes(user.role as "ADMIN" | "OPERATOR" | "REVIEWER")
                    );
                    if (visibleItems.length === 0) return null;
                    return (
                        <div key={section.label} className="pt-3 border-t border-[var(--border)]/20">
                            {!collapsed && (
                                <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)] px-3 mb-1 select-none">
                                    {section.label}
                                </p>
                            )}
                            <div className="space-y-0.5">
                                {visibleItems.map((item) => {
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
                                            onNavClick={mobileClose}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </nav>


            <div className={[
                "flex items-center gap-3 px-3 py-4 border-t border-[var(--border)]",
                collapsed ? "flex-col" : "",
            ].join(" ")}>
                <Link
                    href="/dashboard/settings/profile"
                    onClick={mobileClose}
                    aria-label={user ? `Account settings for ${user.firstName} ${user.lastName}` : "Account settings"}
                    title="Account settings"
                    className="w-8 h-8 rounded-full bg-gradient-to-br from-[var(--red)] to-[var(--red-dim)] flex items-center justify-center text-xs font-bold text-white flex-shrink-0 hover:ring-2 hover:ring-[var(--red)]/40 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
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
                    onClick={toggleTheme}
                    aria-label="Toggle theme"
                    title={isLight ? "Use dark theme" : "Use light theme"}
                    className="flex-shrink-0 p-1.5 rounded-md text-[var(--text-secondary)] hover:text-[var(--red-text)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                >
                    {isLight ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <circle cx="12" cy="12" r="5" />
                            <line x1="12" y1="1" x2="12" y2="3" />
                            <line x1="12" y1="21" x2="12" y2="23" />
                            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                            <line x1="1" y1="12" x2="3" y2="12" />
                            <line x1="21" y1="12" x2="23" y2="12" />
                            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                        </svg>
                    ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                        </svg>
                    )}
                </button>
                <button
                    onClick={handleLogout}
                    aria-label="Log out"
                    title="Log out"
                    className="flex-shrink-0 p-1.5 rounded-md text-[var(--text-secondary)] hover:text-[var(--red-text)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
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