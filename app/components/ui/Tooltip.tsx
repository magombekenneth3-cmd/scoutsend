"use client";

import React, { useState } from "react";

export interface TooltipProps {
    content: React.ReactNode;
    children: React.ReactNode;
    position?: "top" | "bottom" | "left" | "right";
    delayMs?: number;
}

export function Tooltip({ content, children, position = "top", delayMs = 150 }: TooltipProps) {
    const [isVisible, setIsVisible] = useState(false);
    const [timer, setTimer] = useState<NodeJS.Timeout | null>(null);

    const handleMouseEnter = () => {
        const timeout = setTimeout(() => setIsVisible(true), delayMs);
        setTimer(timeout);
    };

    const handleMouseLeave = () => {
        if (timer) clearTimeout(timer);
        setIsVisible(false);
    };

    const positionClasses = {
        top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
        bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
        left: "right-full top-1/2 -translate-y-1/2 mr-2",
        right: "left-full top-1/2 -translate-y-1/2 ml-2",
    };

    return (
        <div
            className="relative inline-flex items-center"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onFocus={handleMouseEnter}
            onBlur={handleMouseLeave}
        >
            {children}
            {isVisible && (
                <div
                    role="tooltip"
                    className={`absolute z-50 px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] bg-[var(--surface-2)] border border-[var(--border)] rounded-md shadow-xl backdrop-blur-md whitespace-nowrap pointer-events-none animate-fade-in ${positionClasses[position]}`}
                >
                    {content}
                </div>
            )}
        </div>
    );
}
