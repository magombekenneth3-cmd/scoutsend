"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type GlassModalSize = "sm" | "md" | "lg" | "xl";

const SIZE_CLASSES: Record<GlassModalSize, string> = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-4xl",
    xl: "max-w-5xl",
};

interface GlassModalProps {
    isOpen: boolean;
    onClose: () => void;
    title?: string;
    size?: GlassModalSize;
    children: ReactNode;
    labelId?: string;
    /** Show a destructive (red) header accent */
    danger?: boolean;
}

/**
 * GlassModal — centered dialog with glassmorphism surface.
 * Uses the native <dialog> element for proper focus-trap and browser accessibility.
 */
export function GlassModal({
    isOpen,
    onClose,
    title,
    size = "md",
    children,
    labelId,
    danger = false,
}: GlassModalProps) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (isOpen) {
            dialog.showModal();
            // Tiny RAF so the `visible` flip always fires after mount
            requestAnimationFrame(() => setVisible(true));
        } else {
            setVisible(false);
            const timer = setTimeout(() => dialog.close(), 150);
            return () => clearTimeout(timer);
        }
    }, [isOpen]);

    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === "Escape") onClose();
        }
        if (isOpen) window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, onClose]);

    function handleCancel(e: React.SyntheticEvent) {
        e.preventDefault();
        onClose();
    }

    return (
        <dialog
            ref={dialogRef}
            onCancel={handleCancel}
            aria-labelledby={labelId}
            aria-modal="true"
            className="modal-panel"
            style={{ zIndex: 9999 }}
        >
            {/* Backdrop */}
            <div
                className={[
                    "fixed inset-0 modal-backdrop-blur transition-opacity",
                    visible ? "opacity-100" : "opacity-0",
                ].join(" ")}
                style={{
                    transitionDuration: visible ? "300ms" : "150ms",
                    transitionTimingFunction: visible ? "var(--ease-expo)" : "var(--ease-smooth)",
                }}
                onClick={onClose}
                aria-hidden="true"
            />

            {/* Panel */}
            <div
                className={[
                    "fixed inset-0 flex items-center justify-center p-4 pointer-events-none",
                ].join(" ")}
                aria-hidden="true"
            >
                <div
                    className={[
                        `pointer-events-auto w-full ${SIZE_CLASSES[size]}`,
                        "card-glass gradient-border",
                        "transition-all",
                        visible
                            ? "opacity-100 translate-y-0"
                            : "opacity-0 translate-y-3",
                    ].join(" ")}
                    style={{
                        transitionDuration: visible ? "300ms" : "150ms",
                        transitionTimingFunction: visible ? "var(--ease-expo)" : "var(--ease-smooth)",
                    }}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby={labelId}
                    onClick={(e) => e.stopPropagation()}
                >
                    {title && (
                        <div
                            className={[
                                "flex items-center justify-between px-6 py-4 border-b border-[var(--glass-border)]",
                                danger ? "border-b-[var(--border-red)]" : "",
                            ].join(" ")}
                        >
                            {/* Header accent gradient line */}
                            <div
                                className={[
                                    "absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl",
                                    danger
                                        ? "bg-gradient-to-r from-transparent via-[var(--danger)] to-transparent"
                                        : "bg-gradient-to-r from-transparent via-[var(--red)] to-transparent",
                                    "opacity-80",
                                ].join(" ")}
                                aria-hidden="true"
                            />

                            <h2
                                id={labelId}
                                className="text-base font-bold font-display text-[var(--text-primary)] tracking-tight"
                            >
                                {title}
                            </h2>

                            <button
                                onClick={onClose}
                                aria-label="Close dialog"
                                className="interactive-spring ml-4 w-8 h-8 flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                            >
                                <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    aria-hidden="true"
                                >
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        </div>
                    )}

                    <div className="relative">{children}</div>
                </div>
            </div>
        </dialog>
    );
}
