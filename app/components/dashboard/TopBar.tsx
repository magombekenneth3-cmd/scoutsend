"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { Fragment, useState, useEffect, type ReactNode } from "react";

interface Breadcrumb {
    label: string;
    href: string;
}

interface TopBarProps {
    title: string;
    subtitle?: string;
    breadcrumbs?: Breadcrumb[];
    actions?: React.ReactNode;
    campaignBadge?: { name: string; href: string };
}

interface SettingsTab {
    href: string;
    label: string;
    icon: ReactNode;
    adminOnly?: boolean;
    operatorPlus?: boolean;
}

const SETTINGS_TABS: SettingsTab[] = [
    {
        href: "/dashboard/settings/profile",
        label: "Profile",
        icon: (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
            </svg>
        ),
    },
    {
        href: "/dashboard/settings/brand",
        label: "Brand",
        icon: (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
        ),
        operatorPlus: true,
    },
    {
        href: "/dashboard/settings/users",
        label: "Users",
        icon: (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
        ),
        adminOnly: true,
    },
    {
        href: "/dashboard/settings/suppression",
        label: "Suppression",
        icon: (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
        ),
        operatorPlus: true,
    },
    {
        href: "/dashboard/settings/audit-logs",
        label: "Audit Log",
        icon: (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
            </svg>
        ),
        adminOnly: true,
    },
    {
        href: "/dashboard/settings/ai-traces",
        label: "AI Traces",
        icon: (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
        ),
        adminOnly: true,
    },
    {
        href: "/dashboard/settings/learning",
        label: "Learning",
        icon: (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
        ),
        adminOnly: true,
    },
    {
        href: "/dashboard/settings/admin",
        label: "Admin",
        icon: (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
        ),
        adminOnly: true,
    },
];

export function TopBar({ title, subtitle, breadcrumbs, actions, campaignBadge }: TopBarProps) {
    const pathname = usePathname();
    const [role, setRole] = useState<string | null>(null);

    const isSettings = pathname.startsWith("/dashboard/settings");

    useEffect(() => {
        if (!isSettings) return;
        fetch("/api/auth/me")
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => { if (data?.role) setRole(data.role); })
            .catch(() => {});
    }, [isSettings]);

    const visibleTabs = SETTINGS_TABS.filter((t) => {
        if (t.adminOnly) return role === "ADMIN";
        if (t.operatorPlus) return role === "ADMIN" || role === "OPERATOR";
        return true;
    });

    if (isSettings) {
        return (
            <header className="flex flex-col justify-between h-[96px] bg-[var(--navy-mid)] border-b border-[var(--border)] flex-shrink-0 overflow-hidden">
                {/* Top deck: Titles & Actions */}
                <div className="flex items-center justify-between pl-14 lg:pl-6 pr-6 pt-3.5 pb-1 flex-1 min-w-0">
                    <div className="min-w-0">
                        <h1 className="text-sm font-semibold font-display text-[var(--text-primary)] leading-none truncate">
                            Settings
                        </h1>
                        {subtitle && (
                            <p className="text-[11px] text-[var(--text-muted)] mt-1 truncate">
                                {subtitle}
                            </p>
                        )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                        {actions}
                    </div>
                </div>

                {/* Bottom deck: Navigation Tabs */}
                <div className="pl-14 lg:pl-6 pr-6 border-t border-[var(--border)]/30 flex-shrink-0">
                    <div className="flex items-center gap-5 overflow-x-auto no-scrollbar h-9">
                        {visibleTabs.map((tab) => {
                            const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
                            return (
                                <Link
                                    key={tab.href}
                                    href={tab.href}
                                    aria-current={active ? "page" : undefined}
                                    className={[
                                        "relative flex items-center gap-1.5 h-full px-1 text-[10px] font-bold tracking-wider uppercase transition-colors duration-150 focus-visible:outline-none",
                                        active
                                            ? "text-[var(--red-text)]"
                                            : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                                    ].join(" ")}
                                >
                                    <span className="flex-shrink-0 opacity-80">{tab.icon}</span>
                                    <span>{tab.label}</span>
                                    {active && (
                                        <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--red)] rounded-t-full" aria-hidden="true" />
                                    )}
                                </Link>
                            );
                        })}
                    </div>
                </div>
            </header>
        );
    }

    return (
        <header className="flex items-center justify-between h-16 pl-14 lg:pl-6 pr-6 border-b border-[var(--border)] bg-[var(--navy-mid)] flex-shrink-0">
            <div className="flex items-center gap-3 min-w-0">
                <div className="min-w-0">
                    {breadcrumbs && breadcrumbs.length > 0 && (
                        <nav aria-label="Breadcrumb" className="flex items-center gap-1 mb-0.5">
                            {breadcrumbs.map((crumb, i) => {
                                const isLast = i === breadcrumbs.length - 1;
                                return (
                                    <Fragment key={crumb.href}>
                                        {isLast ? (
                                            <span
                                                className="text-xs text-[var(--text-secondary)] font-medium"
                                                aria-current="page"
                                            >
                                                {crumb.label}
                                            </span>
                                        ) : (
                                            <Link
                                                href={crumb.href}
                                                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors duration-150 focus-visible:outline-none focus-visible:underline"
                                            >
                                                {crumb.label}
                                            </Link>
                                        )}
                                        {i < breadcrumbs.length - 1 && (
                                            <span className="text-[var(--text-muted)] text-xs" aria-hidden="true">›</span>
                                        )}
                                    </Fragment>
                                );
                            })}
                        </nav>
                    )}
                    <h1 className="text-base font-semibold font-display text-[var(--text-primary)] leading-none truncate">
                        {title}
                    </h1>
                    {subtitle && (
                        <p className="text-xs text-[var(--text-muted)] mt-1">{subtitle}</p>
                    )}
                </div>

                {campaignBadge && (
                    <Link
                        href={campaignBadge.href}
                        className="inline-flex items-center gap-1.5 max-w-[125px] sm:max-w-[200px] px-2.5 py-1 rounded-full text-[10px] font-semibold bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-red)] hover:text-[var(--text-primary)] transition-colors duration-150 truncate flex-shrink-0"
                        title={`Campaign: ${campaignBadge.name}`}
                    >
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                            <rect x="9" y="3" width="6" height="4" rx="1" />
                        </svg>
                        <span className="truncate">{campaignBadge.name}</span>
                    </Link>
                )}
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
                <button
                    aria-label="Notifications"
                    className="relative flex items-center justify-center w-9 h-9 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                    </svg>
                </button>
                {actions}
            </div>
        </header>
    );
}