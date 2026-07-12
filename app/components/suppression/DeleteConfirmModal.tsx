"use client";

import { useEffect, useRef } from "react";

interface Props {
    open: boolean;
    target: string;
    onConfirm: () => void;
    onCancel: () => void;
    deleting: boolean;
}

export function DeleteConfirmDialog({ open, target, onConfirm, onCancel, deleting }: Props) {
    const ref = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        if (open) {
            if (!el.open) el.showModal();
        } else {
            if (el.open) el.close();
        }
    }, [open]);

    function handleCancel(e: React.SyntheticEvent) {
        e.preventDefault();
        onCancel();
    }

    function handleBackdrop(e: React.MouseEvent<HTMLDialogElement>) {
        if (e.target === ref.current) onCancel();
    }

    return (
        <dialog
            ref={ref}
            onCancel={handleCancel}
            onClick={handleBackdrop}
            aria-labelledby="del-title"
            className="modal-panel m-auto w-full max-w-sm bg-transparent p-4 backdrop:bg-black/60 backdrop:backdrop-blur-sm"
        >
            <div className="relative w-full bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl p-6 space-y-4">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-red-400/10 border border-red-400/20 flex items-center justify-center flex-shrink-0">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-400">
                            <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                        </svg>
                    </div>
                    <div>
                        <h3 id="del-title" className="text-sm font-semibold text-[var(--text-primary)]">Remove suppression</h3>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">This will allow emails to this address again.</p>
                    </div>
                </div>

                <div className="rounded-lg bg-[var(--navy-mid)] border border-[var(--border)] px-3 py-2">
                    <p className="text-xs font-mono text-[var(--text-secondary)] truncate">{target}</p>
                </div>

                <div className="flex gap-3">
                    <button onClick={onCancel} className="flex-1 h-9 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]">Cancel</button>
                    <button onClick={onConfirm} disabled={deleting}
                        className="flex-1 h-9 rounded-lg bg-red-500 text-white text-sm font-semibold hover:bg-red-600 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 flex items-center justify-center gap-2">
                        {deleting && <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeOpacity="0.2" /><path d="M12 2a10 10 0 0 1 10 10" /></svg>}
                        Remove
                    </button>
                </div>
            </div>
        </dialog>
    );
}