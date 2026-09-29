"use client";

import React, { useId } from "react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
    helperText?: string;
    leftIcon?: React.ReactNode;
    rightIcon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
    ({ label, error, helperText, leftIcon, rightIcon, className = "", id: customId, ...props }, ref) => {
        const generatedId = useId();
        const id = customId || generatedId;

        return (
            <div className="w-full flex flex-col gap-1.5">
                {label && (
                    <label
                        htmlFor={id}
                        className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider font-display"
                    >
                        {label}
                    </label>
                )}
                <div className="relative flex items-center">
                    {leftIcon && (
                        <div className="absolute left-3 text-[var(--text-muted)] pointer-events-none flex items-center">
                            {leftIcon}
                        </div>
                    )}
                    <input
                        ref={ref}
                        id={id}
                        className={`w-full h-10 bg-[var(--surface)] border rounded-lg text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none transition-all ${
                            leftIcon ? "pl-9" : "pl-3"
                        } ${rightIcon ? "pr-9" : "pr-3"} ${
                            error
                                ? "border-[var(--danger-border)] focus:border-[var(--danger)] focus:ring-2 focus:ring-[var(--danger-bg)]"
                                : "border-[var(--border)] focus:border-[var(--border-red)] focus:ring-2 focus:ring-[var(--red-glow)]"
                        } ${className}`}
                        style={{
                            transitionProperty: "border-color, box-shadow, background-color",
                            transitionDuration: "150ms",
                            transitionTimingFunction: "var(--ease-smooth)",
                            ...props.style,
                        }}
                        {...props}
                    />
                    {rightIcon && (
                        <div className="absolute right-3 text-[var(--text-muted)] flex items-center">
                            {rightIcon}
                        </div>
                    )}
                </div>
                {error ? (
                    <p className="text-xs text-[var(--danger)]">{error}</p>
                ) : helperText ? (
                    <p className="text-xs text-[var(--text-muted)]">{helperText}</p>
                ) : null}
            </div>
        );
    }
);

Input.displayName = "Input";
