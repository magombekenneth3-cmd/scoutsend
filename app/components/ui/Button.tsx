"use client";

import React from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: "primary" | "secondary" | "ghost" | "danger";
    size?: "sm" | "md" | "lg";
    isLoading?: boolean;
    leftIcon?: React.ReactNode;
    rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    (
        {
            children,
            variant = "primary",
            size = "md",
            isLoading = false,
            leftIcon,
            rightIcon,
            className = "",
            disabled,
            style,
            ...props
        },
        ref
    ) => {
        const sizeClasses = {
            sm: "px-3 py-1.5 text-xs font-medium gap-1.5 h-8",
            md: "px-4 py-2 text-sm font-semibold gap-2 h-10",
            lg: "px-6 py-3 text-base font-bold gap-2.5 h-12",
        };

        const variantClasses = {
            primary:
                "bg-[var(--red)] text-white hover:bg-[var(--red-dim)] border border-transparent hover:-translate-y-0.5",
            secondary:
                "bg-[var(--surface-2)] text-[var(--text-primary)] hover:bg-[var(--surface)] border border-[var(--border)] hover:-translate-y-0.5",
            ghost:
                "bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] border border-transparent hover:-translate-y-0.5",
            danger:
                "bg-[var(--danger-bg)] text-[var(--danger)] hover:bg-[var(--danger)] hover:text-white border border-[var(--danger-border)] hover:-translate-y-0.5",
        };

        return (
            <button
                ref={ref}
                disabled={disabled || isLoading}
                className={`inline-flex items-center justify-center rounded-lg font-display transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
                style={{
                    transitionProperty: "color, background-color, border-color, transform, box-shadow",
                    transitionDuration: "150ms, 150ms, 150ms, 250ms, 150ms",
                    transitionTimingFunction: "var(--ease-smooth)",
                    ...style,
                }}
                {...props}
            >
                {isLoading ? (
                    <svg
                        className="animate-spin h-4 w-4 text-current"
                        fill="none"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                    >
                        <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                        />
                        <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                    </svg>
                ) : (
                    <>
                        {leftIcon && <span className="flex items-center shrink-0">{leftIcon}</span>}
                        {children}
                        {rightIcon && <span className="flex items-center shrink-0">{rightIcon}</span>}
                    </>
                )}
            </button>
        );
    }
);

Button.displayName = "Button";
