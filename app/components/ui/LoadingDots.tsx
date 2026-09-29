"use client";

type LoadingDotsSize = "sm" | "md" | "lg";

const SIZE_PX: Record<LoadingDotsSize, string> = {
    sm: "4px",
    md: "5px",
    lg: "7px",
};

const GAP_PX: Record<LoadingDotsSize, string> = {
    sm: "3px",
    md: "4px",
    lg: "6px",
};

interface LoadingDotsProps {
    /** Controls dot size */
    size?: LoadingDotsSize;
    /** Tailwind / CSS class applied to the wrapper — use text-* to set color */
    className?: string;
    /** Accessible label for screen-readers */
    label?: string;
}

/**
 * Three-dot bounce loading indicator.
 * Usage: <LoadingDots /> or <LoadingDots size="sm" className="text-[var(--red)]" />
 */
export function LoadingDots({
    size = "md",
    className = "text-[var(--text-muted)]",
    label = "Loading…",
}: LoadingDotsProps) {
    const dotSize = SIZE_PX[size];
    const gap = GAP_PX[size];

    return (
        <span
            role="status"
            aria-label={label}
            className={`loading-dots ${className}`}
            style={{ gap }}
        >
            <span style={{ width: dotSize, height: dotSize }} />
            <span style={{ width: dotSize, height: dotSize }} />
            <span style={{ width: dotSize, height: dotSize }} />
            <span className="sr-only">{label}</span>
        </span>
    );
}
