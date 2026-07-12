"use client";

import { SenderDomain } from "@/app/api/src/lib/domains/domain.type";
import { createDomain } from "@/app/api/src/lib/domains/domainApi";
import { useState, useEffect, useRef } from "react";


interface AddDomainSheetProps {
    open: boolean;
    onClose: () => void;
    onCreated: (domain: SenderDomain) => void;
}

interface FormState {
    domain: string;
    dailyLimit: string;
    warmupEnabled: boolean;
}

const EMPTY: FormState = { domain: "", dailyLimit: "50", warmupEnabled: true };

export function AddDomainSheet({ open, onClose, onCreated }: AddDomainSheetProps) {
    const [form, setForm] = useState<FormState>(EMPTY);
    const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
    const [submitting, setSubmitting] = useState(false);
    const [serverError, setServerError] = useState<string | null>(null);
    const [visible, setVisible] = useState(false);
    const dialogRef = useRef<HTMLDialogElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const el = dialogRef.current;
        if (!el) return;
        if (open) {
            setForm(EMPTY);
            setErrors({});
            setSubmitting(false);
            setServerError(null);
            if (!el.open) el.showModal();
            requestAnimationFrame(() => {
                setVisible(true);
                setTimeout(() => inputRef.current?.focus(), 60);
            });
        } else {
            setVisible(false);
            const timer = setTimeout(() => { if (el.open) el.close(); }, 300);
            return () => clearTimeout(timer);
        }
    }, [open]);

    function set<K extends keyof FormState>(field: K, value: FormState[K]) {
        setForm((f) => ({ ...f, [field]: value }));
        setErrors((e) => ({ ...e, [field]: undefined }));
    }

    function validate(): boolean {
        const e: Partial<Record<keyof FormState, string>> = {};
        const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,}$/;
        if (!form.domain.trim()) {
            e.domain = "Domain is required";
        } else if (!domainRegex.test(form.domain.toLowerCase().trim())) {
            e.domain = "Invalid domain format (e.g. outreach.company.com)";
        }
        const limit = Number(form.dailyLimit);
        if (!form.dailyLimit || isNaN(limit) || limit < 1 || limit > 10000) {
            e.dailyLimit = "Must be between 1 and 10,000";
        }
        setErrors(e);
        return Object.keys(e).length === 0;
    }

    async function handleSubmit() {
        if (!validate()) return;
        setSubmitting(true);
        setServerError(null);
        try {
            const domain = await createDomain({
                domain: form.domain.toLowerCase().trim(),
                dailyLimit: Number(form.dailyLimit),
                warmupEnabled: form.warmupEnabled,
            });
            onCreated(domain as SenderDomain);
        } catch (err) {
            setServerError(err instanceof Error ? err.message : "Something went wrong");
        } finally {
            setSubmitting(false);
        }
    }

    function handleCancel(e: React.SyntheticEvent) {
        e.preventDefault();
        onClose();
    }

    const inputCls =
        "w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-red)] focus:ring-1 focus:ring-[var(--red)]/20 transition-colors duration-150";
    const errorBorder = "border-[var(--red)]/60 focus:border-[var(--red)]";
    const labelCls = "block text-xs font-medium text-[var(--text-secondary)] mb-1.5";

    return (
        <dialog
            ref={dialogRef}
            onCancel={handleCancel}
            aria-label="Add sender domain"
            className="sheet-panel"
        >
            <div
                className="absolute inset-0 bg-black/50"
                onClick={onClose}
                aria-hidden="true"
            />
            <aside
                className={[
                    "absolute top-0 right-0 h-full w-[420px] max-w-full flex flex-col",
                    "bg-[var(--navy-mid)] border-l border-[var(--border)] shadow-2xl",
                    "transition-transform duration-300 ease-in-out",
                    visible ? "translate-x-0" : "translate-x-full",
                ].join(" ")}
            >
                <div className="flex items-center justify-between h-16 px-5 border-b border-[var(--border)] flex-shrink-0">
                    <h2 className="text-sm font-semibold font-display text-[var(--text-primary)]">Add Sender Domain</h2>
                    <button
                        onClick={onClose}
                        aria-label="Close"
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
                    <div>
                        <label htmlFor="sd-domain" className={labelCls}>
                            Domain <span className="text-[var(--red)]">*</span>
                        </label>
                        <input
                            ref={inputRef}
                            id="sd-domain"
                            type="text"
                            inputMode="url"
                            autoComplete="off"
                            className={`${inputCls} ${errors.domain ? errorBorder : ""}`}
                            placeholder="outreach.company.com"
                            value={form.domain}
                            onChange={(e) => set("domain", e.target.value)}
                        />
                        {errors.domain && <p className="mt-1 text-xs text-[var(--red)]">{errors.domain}</p>}
                        <p className="mt-1 text-xs text-[var(--text-muted)]">Use a subdomain dedicated to outreach, not your main domain.</p>
                    </div>

                    <div>
                        <label htmlFor="sd-limit" className={labelCls}>
                            Daily send limit <span className="text-[var(--red)]">*</span>
                        </label>
                        <input
                            id="sd-limit"
                            type="number"
                            min={1}
                            max={10000}
                            className={`${inputCls} ${errors.dailyLimit ? errorBorder : ""}`}
                            placeholder="50"
                            value={form.dailyLimit}
                            onChange={(e) => set("dailyLimit", e.target.value)}
                        />
                        {errors.dailyLimit && <p className="mt-1 text-xs text-[var(--red)]">{errors.dailyLimit}</p>}
                        <p className="mt-1 text-xs text-[var(--text-muted)]">Start low (25–50) during warmup, increase over time.</p>
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border)]">
                        <div>
                            <p className="text-sm font-medium text-[var(--text-primary)]">Enable warmup</p>
                            <p className="text-xs text-[var(--text-muted)] mt-0.5">Gradually increases sending volume to build reputation.</p>
                        </div>
                        <button
                            onClick={() => set("warmupEnabled", !form.warmupEnabled)}
                            role="switch"
                            aria-checked={form.warmupEnabled}
                            aria-label="Toggle warmup"
                            className={[
                                "relative w-10 h-5 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] flex-shrink-0",
                                form.warmupEnabled ? "bg-emerald-500" : "bg-[var(--surface)] border border-[var(--border)]",
                            ].join(" ")}
                        >
                            <span
                                className={[
                                    "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200",
                                    form.warmupEnabled ? "translate-x-5" : "translate-x-0.5",
                                ].join(" ")}
                            />
                        </button>
                    </div>

                    {serverError && (
                        <div className="flex items-start gap-2 p-3 bg-[var(--red-glow)] border border-[var(--border-red)] rounded-lg">
                            <svg className="flex-shrink-0 mt-0.5 text-[var(--red)]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                            </svg>
                            <p className="text-xs text-[var(--red)]">{serverError}</p>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-3 px-5 py-4 border-t border-[var(--border)] flex-shrink-0">
                    <button
                        onClick={onClose}
                        className="flex-1 h-10 rounded-lg text-sm font-medium text-[var(--text-secondary)] bg-[var(--surface-2)] hover:bg-[var(--surface)] border border-[var(--border)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={submitting}
                        className="flex-1 h-10 rounded-lg text-sm font-semibold text-white bg-[var(--red)] hover:bg-[var(--red-dim)] active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-150 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        {submitting ? (
                            <>
                                <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                                </svg>
                                Adding…
                            </>
                        ) : (
                            "Add Domain"
                        )}
                    </button>
                </div>
            </aside>
        </dialog>
    );
}