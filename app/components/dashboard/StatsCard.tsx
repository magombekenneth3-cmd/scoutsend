"use client";

import React from "react";
import { motion } from "framer-motion";

interface StatCardProps {
    label: string;
    value: string | number;
    sub?: string;
    trend?: "up" | "down" | "neutral";
    trendValue?: string;
    icon: React.ReactNode;
    accent?: boolean;
}

export function StatCard({ label, value, sub, trend, trendValue, icon, accent = false }: StatCardProps) {
    const trendColor =
        trend === "up"
            ? "bg-emerald-500/10 text-emerald-400"
            : trend === "down"
                ? "bg-red-500/10 text-red-400"
                : "bg-[var(--surface-2)] text-[var(--text-muted)]";

    const trendArrow = trend === "up" ? "↑" : trend === "down" ? "↓" : "";

    const accessibleLabel = [
        label,
        String(value),
        sub,
        trendValue ? `${trendArrow} ${trendValue} vs last 7 days` : undefined,
    ].filter(Boolean).join(", ");

    return (
        <motion.article
            whileHover={{ y: -2, scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            aria-label={accessibleLabel}
            className={[
                "relative flex flex-col gap-2 rounded-xl p-5 border stat-card-premium gradient-border cursor-pointer",
                "bg-[var(--surface)] border-[var(--border)]",
                accent ? "ring-1 ring-[var(--red-glow)]" : "",
            ].join(" ")}
        >
            {/* Top accent shimmer line */}
            {accent && (
                <div
                    className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[var(--red)] to-transparent opacity-70 rounded-t-xl"
                    aria-hidden="true"
                />
            )}

            <div className="flex items-center justify-between" aria-hidden="true">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                    {label}
                </p>
                <span className="text-[var(--text-muted)] opacity-50 flex-shrink-0">
                    {icon}
                </span>
            </div>

            <div className="flex items-baseline gap-2" aria-hidden="true">
                <p className="stat-value text-2xl font-bold text-[var(--text-primary)] font-display tabular-nums leading-none transition-all duration-300">
                    {value}
                </p>
                {trendValue && (
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md tabular-nums ${trendColor}`}>
                        {trendArrow} {trendValue}
                    </span>
                )}
            </div>

            <p className="text-[10px] text-[var(--text-muted)] leading-normal" aria-hidden="true">
                {sub ?? (trendValue ? "compared to previous 7 days" : "active target rate")}
            </p>
        </motion.article>
    );
}

interface RadialProgressCardProps {
    label: string;
    value: number;
    sub: string;
    trend?: "up" | "down" | "neutral";
    trendValue?: string;
}

export function RadialProgressCard({ label, value, sub, trend, trendValue }: RadialProgressCardProps) {
    const radius = 18;
    const circumference = 2 * Math.PI * radius;
    const clamped = Math.min(100, Math.max(0, value));
    const strokeDashoffset = circumference - (clamped / 100) * circumference;

    const trendColor =
        trend === "up"
            ? "text-emerald-400"
            : trend === "down"
                ? "text-red-400"
                : "text-[var(--text-muted)]";

    const trendArrow = trend === "up" ? "↑" : trend === "down" ? "↓" : "";

    return (
        <motion.article
            whileHover={{ y: -2, scale: 1.01 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            aria-label={`${label}: ${value}%. ${sub}${trendValue ? `. ${trendArrow} ${trendValue}` : ""}`}
            className="card-glass flex items-center gap-4 p-4 stat-card-premium cursor-pointer"
        >
            <div className="relative flex-shrink-0 w-12 h-12" aria-hidden="true">
                <svg viewBox="0 0 48 48" fill="none" className="w-full h-full -rotate-90">
                    <circle
                        cx="24" cy="24" r={radius}
                        stroke="var(--glass-border-hover)"
                        strokeWidth="3.5"
                    />
                    <circle
                        cx="24" cy="24" r={radius}
                        stroke="var(--red)"
                        strokeWidth="3.5"
                        strokeLinecap="round"
                        strokeDasharray={circumference}
                        strokeDashoffset={strokeDashoffset}
                        style={{ transition: "stroke-dashoffset 0.6s ease-out", filter: "drop-shadow(0 0 4px var(--red-glow))" }}
                    />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-[var(--text-primary)]">
                    {clamped}%
                </span>
            </div>

            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-[var(--text-primary)] leading-none truncate">{label}</p>
                    {trendValue && (
                        <span className={`text-[9px] font-semibold tabular-nums flex-shrink-0 ${trendColor}`}>
                            {trendArrow} {trendValue}
                        </span>
                    )}
                </div>
                <p className="text-[10px] text-[var(--text-muted)] mt-1 leading-normal">{sub}</p>
            </div>
        </motion.article>
    );
}