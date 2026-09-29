"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type ModalSize = "sm" | "md" | "lg" | "xl";

const SIZE_CLASSES: Record<ModalSize, string> = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-4xl",
    xl: "max-w-5xl",
};

interface SheetModalProps {
    isOpen: boolean;
    onClose: () => void;
    title?: string;
    size?: ModalSize;
    children: ReactNode;
    labelId?: string;
}

export function SheetModal({ isOpen, onClose, title, size = "md", children, labelId }: SheetModalProps) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (isOpen) {
            dialog.showModal();
            requestAnimationFrame(() => setVisible(true));
        } else {
            setVisible(false);
            const timer = setTimeout(() => dialog.close(), 300);
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
            className="sheet-panel"
        >
            <div
                className={[
                    "absolute inset-0 modal-backdrop-blur transition-opacity duration-300",
                    visible ? "opacity-100" : "opacity-0",
                ].join(" ")}
                onClick={onClose}
                aria-hidden="true"
            />
            <div
                className={[
                    `absolute top-0 right-0 h-full w-full ${SIZE_CLASSES[size]}`,
                    "card-glass rounded-none rounded-l-2xl border-l border-[var(--glass-border)] flex flex-col shadow-2xl",
                    "transition-transform duration-400",
                    visible ? "translate-x-0" : "translate-x-full",
                ].join(" ")}
                style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
            >
                {title && (
                    <div className="flex items-center justify-between px-6 py-5 border-b border-[var(--glass-border)] flex-shrink-0">
                        <h2 id={labelId} className="text-sm font-semibold font-display text-[var(--text-primary)]">
                            {title}
                        </h2>
                        <button
                            onClick={onClose}
                            aria-label="Close"
                            className="interactive-spring w-8 h-8 flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-bg-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        </button>
                    </div>
                )}
                {children}
            </div>
        </dialog>
    );
}
