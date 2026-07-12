"use client";

import { useState, useEffect, useRef } from "react";

interface Props {
    open: boolean;
    onClose: () => void;
    onImported: () => void;
}

interface SkippedEntry {
    index: number;
    value: string;
    reason: string;
}

interface BulkResult {
    created: number;
    skipped: number;
    failed: number;
    total: number;
    details: {
        skipped: SkippedEntry[];
        failed: SkippedEntry[];
    };
}

interface InvalidEntry {
    raw: string;
    reason: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_RE =
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-zA-Z]{2,63}$/i;

function classifyEntry(line: string): { valid: boolean; reason?: string } {
    if (EMAIL_RE.test(line)) return { valid: true };
    if (DOMAIN_RE.test(line)) return { valid: true };
    if (line.includes("@"))
        return { valid: false, reason: "Invalid email address" };
    return { valid: false, reason: "Invalid domain format" };
}

export function BulkImportModal({ open, onClose, onImported }: Props) {
    const [raw, setRaw] = useState("");
    const [reason, setReason] = useState("");
    const [source, setSource] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [result, setResult] = useState<BulkResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showSkipped, setShowSkipped] = useState(false);

    const dialogRef = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        const el = dialogRef.current;
        if (!el) return;
        if (open) {
            if (!el.open) el.showModal();
            setRaw("");
            setReason("");
            setSource("");
            setResult(null);
            setError(null);
            setShowSkipped(false);
        } else {
            if (el.open) el.close();
        }
    }, [open]);

    const lines = raw
        .split(/[\n,;]+/)
        .map((l) => l.trim().toLowerCase())
        .filter(Boolean);

    const classified = lines.map((l) => ({ raw: l, ...classifyEntry(l) }));
    const validEntries = classified.filter((e) => e.valid).map((e) => e.raw);
    const invalidEntries: InvalidEntry[] = classified
        .filter((e) => !e.valid)
        .map((e) => ({ raw: e.raw, reason: e.reason! }));

    async function doImport() {
        if (!reason.trim() || validEntries.length === 0) return;
        setSubmitting(true);
        setError(null);

        const entries = validEntries.map((l) => {
            const e: Record<string, string> = { reason: reason.trim() };
            if (source.trim()) e.source = source.trim();
            if (EMAIL_RE.test(l)) e.email = l;
            else e.domain = l;
            return e;
        });

        try {
            const res = await fetch("/api/suppression/bulk", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(entries),
            });
            if (!res.ok) {
                const d = await res.json().catch(() => ({}));
                throw new Error(d?.message ?? `Error ${res.status}`);
            }
            const data: BulkResult = await res.json();
            setResult(data);
            onImported();
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
            aria-labelledby="bulk-title"
            className="modal-panel m-auto w-full max-w-lg bg-transparent p-4 backdrop:bg-black/60 backdrop:backdrop-blur-sm"
        >
            <div className="relative w-full bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
                    <h2
                        id="bulk-title"
                        className="text-sm font-semibold font-display text-[var(--text-primary)]"
                    >
                        Bulk Import
                    </h2>
                    <button
                        onClick={onClose}
                        aria-label="Close"
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>

                {result ? (
                    <div className="px-6 py-8 space-y-5">
                        <div className="text-center space-y-3">
                            <div className="w-12 h-12 rounded-full bg-emerald-400/10 border border-emerald-400/20 flex items-center justify-center mx-auto">
                                <svg
                                    width="22"
                                    height="22"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    className="text-emerald-400"
                                >
                                    <polyline points="20 6 9 17 4 12" />
                                </svg>
                            </div>
                            <p className="text-sm font-semibold text-[var(--text-primary)]">
                                Import complete
                            </p>
                            <div className="flex justify-center gap-8">
                                {(
                                    [
                                        ["added", result.created, "text-emerald-400"],
                                        ["skipped", result.skipped, "text-[var(--text-muted)]"],
                                        ["failed", result.failed, "text-amber-400"],
                                        ["total", result.total, "text-[var(--text-primary)]"],
                                    ] as const
                                ).map(([label, val, cls]) => (
                                    <div key={label} className="text-center">
                                        <p
                                            className={`text-2xl font-bold font-display tabular-nums ${cls}`}
                                        >
                                            {val}
                                        </p>
                                        <p className="text-xs text-[var(--text-muted)]">{label}</p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {(result.details.skipped.length > 0 ||
                            result.details.failed.length > 0) && (
                                <div className="border border-[var(--border)] rounded-xl overflow-hidden">
                                    <button
                                        onClick={() => setShowSkipped((v) => !v)}
                                        className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-2)] transition-colors"
                                    >
                                        <span>
                                            {result.details.skipped.length + result.details.failed.length} entries not imported
                                        </span>
                                        <svg
                                            width="12"
                                            height="12"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2.5"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            className={`transition-transform duration-150 ${showSkipped ? "rotate-180" : ""}`}
                                        >
                                            <polyline points="6 9 12 15 18 9" />
                                        </svg>
                                    </button>

                                    {showSkipped && (
                                        <div className="max-h-40 overflow-y-auto divide-y divide-[var(--border)]">
                                            {[
                                                ...result.details.skipped.map((e) => ({
                                                    ...e,
                                                    type: "skipped" as const,
                                                })),
                                                ...result.details.failed.map((e) => ({
                                                    ...e,
                                                    type: "failed" as const,
                                                })),
                                            ].map((entry, i) => (
                                                <div
                                                    key={i}
                                                    className="flex items-start justify-between gap-3 px-4 py-2"
                                                >
                                                    <span className="text-xs font-mono text-[var(--text-secondary)] truncate min-w-0">
                                                        {entry.value}
                                                    </span>
                                                    <span
                                                        className={`text-xs flex-shrink-0 ${entry.type === "failed"
                                                                ? "text-amber-400"
                                                                : "text-[var(--text-muted)]"
                                                            }`}
                                                    >
                                                        {entry.reason}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                        <div className="flex justify-center">
                            <button
                                onClick={onClose}
                                className="h-9 px-6 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="px-6 py-5 space-y-4">
                            <div className="space-y-1.5">
                                <label
                                    htmlFor="bulk-raw"
                                    className="block text-xs font-semibold text-[var(--text-secondary)]"
                                >
                                    Emails or domains{" "}
                                    <span className="text-[var(--red)]">*</span>
                                    <span className="ml-2 text-[var(--text-muted)] font-normal">
                                        one per line, or comma-separated
                                    </span>
                                </label>
                                <textarea
                                    id="bulk-raw"
                                    value={raw}
                                    onChange={(e) => setRaw(e.target.value)}
                                    placeholder={"bad@spam.com\nexample.com\nanother@test.io"}
                                    rows={6}
                                    className="w-full px-3 py-2.5 rounded-lg bg-[var(--navy-mid)] border border-[var(--border)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-red)] focus:ring-1 focus:ring-[var(--red)]/30 transition-colors font-mono resize-none"
                                />
                                {lines.length > 0 && (
                                    <p className="text-xs text-[var(--text-muted)]">
                                        <span className="text-emerald-400 font-medium">
                                            {validEntries.length} valid
                                        </span>
                                        {invalidEntries.length > 0 && (
                                            <span className="ml-2 text-amber-400 font-medium">
                                                {invalidEntries.length} invalid (will be skipped)
                                            </span>
                                        )}
                                    </p>
                                )}

                                {invalidEntries.length > 0 && (
                                    <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 space-y-1 max-h-28 overflow-y-auto">
                                        {invalidEntries.map((entry, i) => (
                                            <div key={i} className="flex items-baseline gap-2">
                                                <span className="text-xs font-mono text-amber-400 truncate min-w-0">
                                                    {entry.raw}
                                                </span>
                                                <span className="text-xs text-[var(--text-muted)] flex-shrink-0">
                                                    — {entry.reason}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="space-y-1.5">
                                <label
                                    htmlFor="bulk-reason"
                                    className="block text-xs font-semibold text-[var(--text-secondary)]"
                                >
                                    Reason <span className="text-[var(--red)]">*</span>
                                </label>
                                <input
                                    id="bulk-reason"
                                    type="text"
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                    placeholder="Applied to all entries"
                                    className="w-full h-9 px-3 rounded-lg bg-[var(--navy-mid)] border border-[var(--border)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-red)] focus:ring-1 focus:ring-[var(--red)]/30 transition-colors"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <label
                                    htmlFor="bulk-source"
                                    className="block text-xs font-semibold text-[var(--text-secondary)]"
                                >
                                    Source{" "}
                                    <span className="text-[var(--text-muted)] font-normal">
                                        (optional)
                                    </span>
                                </label>
                                <input
                                    id="bulk-source"
                                    type="text"
                                    value={source}
                                    onChange={(e) => setSource(e.target.value)}
                                    placeholder="e.g. csv-import, manual"
                                    className="w-full h-9 px-3 rounded-lg bg-[var(--navy-mid)] border border-[var(--border)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-red)] focus:ring-1 focus:ring-[var(--red)]/30 transition-colors"
                                />
                            </div>

                            {error && (
                                <p
                                    role="alert"
                                    className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2"
                                >
                                    {error}
                                </p>
                            )}
                        </div>

                        <div className="flex gap-3 px-6 py-4 border-t border-[var(--border)]">
                            <button
                                onClick={onClose}
                                className="flex-1 h-9 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={doImport}
                                disabled={
                                    submitting || validEntries.length === 0 || !reason.trim()
                                }
                                className="flex-1 h-9 rounded-lg bg-[var(--red)] text-white text-sm font-semibold hover:bg-[var(--red-dim)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] flex items-center justify-center gap-2"
                            >
                                {submitting && (
                                    <svg
                                        className="animate-spin w-3.5 h-3.5"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                    >
                                        <circle cx="12" cy="12" r="10" strokeOpacity="0.2" />
                                        <path d="M12 2a10 10 0 0 1 10 10" />
                                    </svg>
                                )}
                                Import{" "}
                                {validEntries.length > 0 ? validEntries.length : ""}{" "}
                                {validEntries.length === 1 ? "Entry" : "Entries"}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </dialog>
    );
}