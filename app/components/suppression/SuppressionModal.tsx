"use client";

import { useState, useRef, useEffect } from "react";

interface Props {
    open: boolean;
    onClose: () => void;
    onAdded: () => void;
}

type Mode = "email" | "domain";

export function AddSuppressionModal({ open, onClose, onAdded }: Props) {
    const [mode, setMode] = useState<Mode>("email");
    const [value, setValue] = useState("");
    const [reason, setReason] = useState("");
    const [source, setSource] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const dialogRef = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        const el = dialogRef.current;
        if (!el) return;
        if (open) {
            if (!el.open) el.showModal();
            setValue(""); setReason(""); setSource(""); setError(null); setMode("email");
            setTimeout(() => inputRef.current?.focus(), 40);
        } else {
            if (el.open) el.close();
        }
    }, [open]);

    async function submit() {
        if (!value.trim() || !reason.trim()) { setError("Both value and reason are required."); return; }
        setSubmitting(true); setError(null);
        try {
            const body: Record<string, string> = { reason: reason.trim() };
            if (source.trim()) body.source = source.trim();
            if (mode === "email") body.email = value.trim();
            else body.domain = value.trim();

            const res = await fetch("/api/suppression", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const d = await res.json().catch(() => ({}));
                throw new Error(d?.message ?? d?.error ?? `Error ${res.status}`);
            }
            onAdded(); onClose();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setSubmitting(false);
        }
    }

    function handleCancel(e: React.SyntheticEvent) {
        e.preventDefault();
        onClose();
    }

    function handleBackdrop(e: React.MouseEvent<HTMLDialogElement>) {
        if (e.target === dialogRef.current) onClose();
    }

    return (
        <dialog
            ref={dialogRef}
            onCancel={handleCancel}
            onClick={handleBackdrop}
            aria-labelledby="add-modal-title"
            className="modal-panel m-auto w-full max-w-md bg-transparent p-4 backdrop:bg-black/60 backdrop:backdrop-blur-sm"
        >
            <div className="relative w-full bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden">

                <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
                    <h2 id="add-modal-title" className="text-sm font-semibold font-display text-[var(--text-primary)]">Add to Suppression List</h2>
                    <button onClick={onClose} aria-label="Close" className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                </div>

                <div className="px-6 py-5 space-y-4">
                    <div className="flex rounded-lg bg-[var(--surface-2)] p-1 gap-1">
                        {(["email", "domain"] as Mode[]).map((m) => (
                            <button key={m} onClick={() => { setMode(m); setValue(""); setError(null); }}
                                className={["flex-1 py-1.5 text-xs font-semibold rounded-md transition-all duration-150 capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]", mode === m ? "bg-[var(--surface)] text-[var(--text-primary)] shadow-sm border border-[var(--border)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"].join(" ")}>
                                {m}
                            </button>
                        ))}
                    </div>

                    <div className="space-y-1.5">
                        <label htmlFor="sup-value" className="block text-xs font-semibold text-[var(--text-secondary)]">
                            {mode === "email" ? "Email address" : "Domain"} <span className="text-[var(--red)]">*</span>
                        </label>
                        <input id="sup-value" ref={inputRef} type={mode === "email" ? "email" : "text"} value={value}
                            onChange={(e) => { setValue(e.target.value); setError(null); }}
                            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                            placeholder={mode === "email" ? "name@company.com" : "company.com"}
                            className="w-full h-9 px-3 rounded-lg bg-[var(--navy-mid)] border border-[var(--border)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-red)] focus:ring-1 focus:ring-[var(--red)]/30 transition-colors font-mono" />
                    </div>

                    <div className="space-y-1.5">
                        <label htmlFor="sup-reason" className="block text-xs font-semibold text-[var(--text-secondary)]">
                            Reason <span className="text-[var(--red)]">*</span>
                        </label>
                        <input id="sup-reason" type="text" value={reason}
                            onChange={(e) => { setReason(e.target.value); setError(null); }}
                            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                            placeholder="e.g. Unsubscribe, bounce, manual block"
                            className="w-full h-9 px-3 rounded-lg bg-[var(--navy-mid)] border border-[var(--border)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-red)] focus:ring-1 focus:ring-[var(--red)]/30 transition-colors" />
                    </div>

                    <div className="space-y-1.5">
                        <label htmlFor="sup-source" className="block text-xs font-semibold text-[var(--text-secondary)]">
                            Source <span className="text-[var(--text-muted)] font-normal">(optional)</span>
                        </label>
                        <input id="sup-source" type="text" value={source} onChange={(e) => setSource(e.target.value)}
                            placeholder="e.g. manual, reply-auto, import"
                            className="w-full h-9 px-3 rounded-lg bg-[var(--navy-mid)] border border-[var(--border)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-red)] focus:ring-1 focus:ring-[var(--red)]/30 transition-colors" />
                    </div>

                    {error && <p role="alert" className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</p>}
                </div>

                <div className="flex gap-3 px-6 py-4 border-t border-[var(--border)]">
                    <button onClick={onClose} className="flex-1 h-9 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]">Cancel</button>
                    <button onClick={submit} disabled={submitting || !value.trim() || !reason.trim()}
                        className="flex-1 h-9 rounded-lg bg-[var(--red)] text-white text-sm font-semibold hover:bg-[var(--red-dim)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] flex items-center justify-center gap-2">
                        {submitting && <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeOpacity="0.2" /><path d="M12 2a10 10 0 0 1 10 10" /></svg>}
                        Add to List
                    </button>
                </div>
            </div>
        </dialog>
    );
}