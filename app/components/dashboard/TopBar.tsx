"use client";

import Link from "next/link";
import React, { Fragment } from "react";

interface Breadcrumb {
    label: string;
    href: string;
}

interface TopBarProps {
    title: string;
    subtitle?: string;
    breadcrumbs?: Breadcrumb[];
    actions?: React.ReactNode;
}

export function TopBar({ title, subtitle, breadcrumbs, actions }: TopBarProps) {
    return (
        <header className="flex items-center justify-between h-16 px-6 border-b border-[var(--border)] bg-[var(--navy-mid)] flex-shrink-0">
            {/* Left: breadcrumbs + title */}
            <div>
                {breadcrumbs && breadcrumbs.length > 0 && (
                    <nav aria-label="Breadcrumb" className="flex items-center gap-1 mb-0.5">
                        {breadcrumbs.map((crumb, i) => (
                            <Fragment key={crumb.href}>
                                <Link
                                    href={crumb.href}
                                    className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors focus-visible:outline-none focus-visible:underline"
                                >
                                    {crumb.label}
                                </Link>
                                {i < breadcrumbs.length - 1 && (
                                    <span className="text-[var(--text-muted)] text-xs" aria-hidden="true">›</span>
                                )}
                            </Fragment>
                        ))}
                    </nav>
                )}
                <h1 className="text-base font-semibold font-display text-[var(--text-primary)] leading-none">
                    {title}
                </h1>
                {subtitle && (
                    <p className="text-xs text-[var(--text-muted)] mt-1">{subtitle}</p>
                )}
            </div>

            {/* Right: actions */}
            <div className="flex items-center gap-2">
                {/* Notification bell */}
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