"use client";

import React, { useState, useEffect, useRef } from "react";

interface Campaign {
    id: string;
    name: string;
    status: string;
}

interface CsvImportResult {
    created: number;
    skipped: number;
    invalid: number;
    details: {
        skipped: Array<{ row: number; reason: string }>;
        invalid: Array<{ row: number; reason: string }>;
    };
}

interface Props {
    campaigns: Campaign[];
    defaultCampaignId: string;
    onClose: () => void;
    onImported: () => void;
}

export function CsvImportModal({
    campaigns,
    defaultCampaignId,
    onClose,
    onImported,
}: Props) {
    const [campaignId, setCampaignId] = useState(defaultCampaignId || campaigns[0]?.id || "");
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [result, setResult] = useState<CsvImportResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showDetails, setShowDetails] = useState(false);
    const dialogRef = useRef<HTMLDialogElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const el = dialogRef.current;
        if (el && !el.open) el.showModal();
    }, []);

    useEffect(() => {
        const fn = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
        window.addEventListener("keydown", fn);
        return () => window.removeEventListener("keydown", fn);
    }, [onClose]);

    async function handleUpload() {
        if (!file || !campaignId) return;
        setUploading(true);
        setError(null);

        const token = typeof window !== "undefined" ? localStorage.getItem("ss_token") : "";
        const formData = new FormData();
        formData.append("file", file);

        try {
            const res = await fetch(`/api/import/csv/${campaignId}`, {
                method: "POST",
                headers: {
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: formData,
            });

            const data = await res.json();

            if (!res.ok && res.status !== 207) {
                throw new Error(data?.error ?? `Server error ${res.status}`);
            }

            setResult(data as CsvImportResult);
            onImported();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Upload failed");
        } finally {
            setUploading(false);
        }
    }

    function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const f = e.target.files?.[0] ?? null;
        setFile(f);
        setError(null);
        setResult(null);
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
            aria-labelledby="csv-import-title"
            className="modal-panel m-auto w-full max-w-md bg-transparent p-4 backdrop:bg-black/60 backdrop:backdrop-blur-sm"
        >
            <div className="relative w-full bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden">

                <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
                    <div>
                        <h2 id="csv-import-title" className="text-sm font-semibold font-display text-[var(--text-primary)]">
                            Import leads from CSV
                        </h2>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            Required: <span className="font-medium text-[var(--text-secondary)]">companyName</span>
                            {" "}· Optional: email, firstName, lastName, title, website, linkedinUrl
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="Close"
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>

                {result ? (
                    <div className="px-6 py-8 space-y-5">
                        <div className="text-center space-y-3">
                            <div className="w-12 h-12 rounded-full bg-emerald-400/10 border border-emerald-400/20 flex items-center justify-center mx-auto">
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
                                    <polyline points="20 6 9 17 4 12" />
                                </svg>
                            </div>
                            <p className="text-sm font-semibold text-[var(--text-primary)]">Import complete</p>
                            <div className="flex justify-center gap-6">
                                {(
                                    [
                                        { label: "created", val: result.created, cls: "text-emerald-400" },
                                        { label: "skipped", val: result.skipped, cls: "text-[var(--text-muted)]" },
                                        { label: "invalid", val: result.invalid, cls: "text-amber-400" },
                                    ] as { label: string; val: number; cls: string }[]
                                ).map(({ label, val, cls }) => (
                                    <div key={label} className="text-center">
                                        <p className={`text-2xl font-bold font-display tabular-nums ${cls}`}>{val}</p>
                                        <p className="text-xs text-[var(--text-muted)]">{label}</p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {(result.details.skipped.length > 0 || result.details.invalid.length > 0) && (
                            <div className="border border-[var(--border)] rounded-xl overflow-hidden">
                                <button
                                    onClick={() => setShowDetails((v) => !v)}
                                    className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-2)] transition-colors"
                                >
                                    <span>{result.details.skipped.length + result.details.invalid.length} rows not imported</span>
                                    <svg
                                        width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                                        className={`transition-transform duration-150 ${showDetails ? "rotate-180" : ""}`}
                                    >
                                        <polyline points="6 9 12 15 18 9" />
                                    </svg>
                                </button>
                                {showDetails && (
                                    <div className="max-h-44 overflow-y-auto divide-y divide-[var(--border)]">
                                        {[
                                            ...result.details.invalid.map((e) => ({ ...e, type: "invalid" as const })),
                                            ...result.details.skipped.map((e) => ({ ...e, type: "skipped" as const })),
                                        ].map((entry, i) => (
                                            <div key={i} className="flex items-baseline justify-between gap-3 px-4 py-2">
                                                <span className="text-xs text-[var(--text-muted)] tabular-nums flex-shrink-0">Row {entry.row}</span>
                                                <span className={`text-xs truncate ${entry.type === "invalid" ? "text-amber-400" : "text-[var(--text-muted)]"}`}>
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
                                <label htmlFor="csv-campaign" className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-widest">
                                    Campaign <span className="text-[var(--red)]">*</span>
                                </label>
                                <select
                                    id="csv-campaign"
                                    value={campaignId}
                                    onChange={(e) => setCampaignId(e.target.value)}
                                    className="w-full px-3 py-2 text-sm bg-[var(--surface-2)] border border-[var(--border)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-red)] focus:ring-1 focus:ring-[var(--red)] transition-colors"
                                >
                                    <option value="">Select a campaign…</option>
                                    {campaigns.map((c) => (
                                        <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="space-y-1.5">
                                <label htmlFor="csv-file" className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-widest">
                                    CSV file <span className="text-[var(--red)]">*</span>
                                </label>
                                <div
                                    className={`relative flex flex-col items-center justify-center gap-2 px-4 py-8 rounded-xl border-2 border-dashed transition-colors cursor-pointer ${file
                                            ? "border-emerald-400/40 bg-emerald-400/5"
                                            : "border-[var(--border)] hover:border-[var(--border-red)] hover:bg-[var(--red-glow)]"
                                        }`}
                                    onClick={() => fileRef.current?.click()}
                                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileRef.current?.click(); }}
                                    role="button"
                                    tabIndex={0}
                                    aria-label="Choose CSV file"
                                >
                                    <input
                                        ref={fileRef}
                                        id="csv-file"
                                        type="file"
                                        accept=".csv,text/csv"
                                        onChange={handleFileChange}
                                        className="sr-only"
                                    />
                                    {file ? (
                                        <>
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400" aria-hidden="true">
                                                <polyline points="20 6 9 17 4 12" />
                                            </svg>
                                            <p className="text-sm font-medium text-[var(--text-primary)] text-center truncate max-w-full px-4">{file.name}</p>
                                            <p className="text-xs text-[var(--text-muted)]">{(file.size / 1024).toFixed(1)} KB · click to change</p>
                                        </>
                                    ) : (
                                        <>
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--text-muted)]" aria-hidden="true">
                                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                                <polyline points="17 8 12 3 7 8" />
                                                <line x1="12" y1="3" x2="12" y2="15" />
                                            </svg>
                                            <p className="text-sm text-[var(--text-secondary)]">Click to choose a CSV file</p>
                                            <p className="text-xs text-[var(--text-muted)]">Max 5 MB · 5,000 rows</p>
                                        </>
                                    )}
                                </div>
                            </div>

                            {error && (
                                <p role="alert" className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
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
                                onClick={handleUpload}
                                disabled={uploading || !file || !campaignId}
                                className="flex-1 h-9 rounded-lg bg-[var(--red)] text-white text-sm font-semibold hover:bg-[var(--red-dim)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] flex items-center justify-center gap-2"
                            >
                                {uploading && (
                                    <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <circle cx="12" cy="12" r="10" strokeOpacity="0.2" />
                                        <path d="M12 2a10 10 0 0 1 10 10" />
                                    </svg>
                                )}
                                {uploading ? "Uploading…" : "Import"}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </dialog>
    );
}