"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Campaign {
    id: string;
    name: string;
    status: string;
}

interface DetectResult {
    columns: string[];
    suggestedMappings: Record<string, string>;
    preview: Record<string, string>[];
    totalRows: number;
    canonicalFields: Record<string, string>;
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

// ── Canonical field options shown in the mapping dropdown ─────────────────────

const FIELD_OPTIONS = [
    { value: "ignore",      label: "— Ignore —",                     muted: true },
    { value: "companyName", label: "Company Name",                   muted: false },
    { value: "firstName",   label: "First Name",                     muted: false },
    { value: "lastName",    label: "Last Name",                      muted: false },
    { value: "fullName",    label: "Full Name  (auto-split)",         muted: false },
    { value: "email",       label: "Email",                          muted: false },
    { value: "title",       label: "Job Title",                      muted: false },
    { value: "website",     label: "Website",                        muted: false },
    { value: "linkedinUrl", label: "LinkedIn URL",                   muted: false },
    { value: "phone",       label: "Phone",                          muted: false },
    { value: "department",  label: "Department",                     muted: false },
    { value: "seniority",   label: "Seniority",                      muted: false },
    { value: "country",     label: "Country",                        muted: false },
    { value: "consentBasis","label": "GDPR Consent Basis",           muted: false },
];

const REQUIRED_FIELDS = new Set(["companyName"]);

type Step = "upload" | "map" | "done";

// ── Component ─────────────────────────────────────────────────────────────────

export function CsvImportModal({ campaigns, defaultCampaignId, onClose, onImported }: Props) {
    const [step, setStep] = useState<Step>("upload");
    const [campaignId, setCampaignId] = useState(defaultCampaignId || campaigns[0]?.id || "");
    const [file, setFile] = useState<File | null>(null);
    const [detecting, setDetecting] = useState(false);
    const [detectResult, setDetectResult] = useState<DetectResult | null>(null);
    const [mappings, setMappings] = useState<Record<string, string>>({});
    const [importing, setImporting] = useState(false);
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

    const handleFileChange = useCallback((f: File | null) => {
        setFile(f);
        setError(null);
        setDetectResult(null);
        setMappings({});
    }, []);

    const handleFileDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (f) handleFileChange(f);
    }, [handleFileChange]);

    async function handleDetect() {
        if (!file || !campaignId) return;
        setDetecting(true);
        setError(null);

        const token = typeof window !== "undefined" ? localStorage.getItem("ss_token") : "";
        const formData = new FormData();
        formData.append("file", file);

        try {
            const res = await fetch(`/api/import/csv/${campaignId}/detect`, {
                method: "POST",
                headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                body: formData,
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error ?? `Error ${res.status}`);

            setDetectResult(data as DetectResult);
            setMappings(data.suggestedMappings);
            setStep("map");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Detection failed");
        } finally {
            setDetecting(false);
        }
    }

    async function handleImport() {
        if (!file || !campaignId || !detectResult) return;
        setImporting(true);
        setError(null);

        const token = typeof window !== "undefined" ? localStorage.getItem("ss_token") : "";
        const formData = new FormData();
        formData.append("file", file);

        // Filter out "ignore" / empty values to avoid massive URL lengths
        const cleanMappings: Record<string, string> = {};
        for (const [k, v] of Object.entries(mappings)) {
            if (v && v !== "ignore") {
                cleanMappings[k] = v;
            }
        }

        const mappingsJson = JSON.stringify(cleanMappings);
        const mappingsParam = encodeURIComponent(mappingsJson);

        try {
            const res = await fetch(
                `/api/import/csv/${campaignId}?mappings=${mappingsParam}`,
                {
                    method: "POST",
                    headers: {
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                        "X-CSV-Mappings": mappingsJson,
                    },
                    body: formData,
                }
            );
            const data = await res.json();
            if (!res.ok && res.status !== 207) throw new Error(data?.error ?? `Server error ${res.status}`);

            setResult(data as CsvImportResult);
            setStep("done");
            onImported();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Import failed");
        } finally {
            setImporting(false);
        }
    }

    // Validation: companyName must be mapped or resolvable from website/email
    const hasCompanyNameMapping = Object.values(mappings).some((v) => v === "companyName");
    const hasWebsiteOrEmailMapping = Object.values(mappings).some((v) => v === "website" || v === "email");
    const hasMandatoryMapping = hasCompanyNameMapping || hasWebsiteOrEmailMapping;

    return (
        <dialog
            ref={dialogRef}
            onCancel={(e) => { e.preventDefault(); onClose(); }}
            onClick={(e) => { if (e.target === dialogRef.current) onClose(); }}
            aria-labelledby="csv-modal-title"
            className="modal-panel m-auto w-full bg-transparent backdrop:bg-black/60 backdrop:backdrop-blur-sm"
            style={{ maxWidth: step === "map" ? "680px" : "440px", padding: "1rem" }}
        >
            <div className="relative w-full bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden">

                {/* ── Header ── */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
                    <div>
                        <h2 id="csv-modal-title" className="text-sm font-semibold font-display text-[var(--text-primary)]">
                            {step === "upload" && "Import Leads from CSV"}
                            {step === "map"    && "Map Columns"}
                            {step === "done"   && "Import Complete"}
                        </h2>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            {step === "upload" && "Select a file to begin"}
                            {step === "map"    && `${detectResult?.totalRows?.toLocaleString()} rows detected · confirm field mapping`}
                            {step === "done"   && "Leads have been added to your campaign"}
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        {/* Step indicators */}
                        <div className="flex items-center gap-1.5">
                            {(["upload", "map", "done"] as Step[]).map((s, i) => (
                                <div
                                    key={s}
                                    className="w-1.5 h-1.5 rounded-full transition-colors"
                                    style={{
                                        background: s === step
                                            ? "var(--red)"
                                            : (["upload", "map", "done"].indexOf(step) > i ? "var(--text-muted)" : "var(--border)"),
                                    }}
                                />
                            ))}
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
                </div>

                {/* ── Step 1: Upload ── */}
                {step === "upload" && (
                    <>
                        <div className="px-6 py-5 space-y-4">
                            {/* Campaign select */}
                            <div className="space-y-1.5">
                                <label htmlFor="csv-campaign" className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-widest">
                                    Campaign <span className="text-[var(--red-text)]">*</span>
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

                            {/* File drop zone */}
                            <div className="space-y-1.5">
                                <label htmlFor="csv-file" className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-widest">
                                    CSV File <span className="text-[var(--red-text)]">*</span>
                                </label>
                                <div
                                    className={`relative flex flex-col items-center justify-center gap-2 px-4 py-8 rounded-xl border-2 border-dashed transition-colors cursor-pointer ${
                                        file
                                            ? "border-emerald-400/40 bg-emerald-400/5"
                                            : "border-[var(--border)] hover:border-[var(--border-red)] hover:bg-[var(--red-glow)]"
                                    }`}
                                    onClick={() => fileRef.current?.click()}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={handleFileDrop}
                                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileRef.current?.click(); }}
                                    role="button"
                                    tabIndex={0}
                                    aria-label="Choose CSV file"
                                >
                                    <input
                                        ref={fileRef}
                                        id="csv-file"
                                        type="file"
                                        accept=".csv,text/csv,.txt"
                                        onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
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
                                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                                            </svg>
                                            <p className="text-sm text-[var(--text-secondary)]">Drop CSV here or click to choose</p>
                                            <p className="text-xs text-[var(--text-muted)]">Max 5 MB · 5,000 rows · any column layout</p>
                                        </>
                                    )}
                                </div>
                            </div>

                            {error && (
                                <p role="alert" className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</p>
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
                                id="csv-detect-btn"
                                onClick={handleDetect}
                                disabled={detecting || !file || !campaignId}
                                className="flex-1 h-9 rounded-lg bg-[var(--red)] text-white text-sm font-semibold hover:bg-[var(--red-dim)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] flex items-center justify-center gap-2"
                            >
                                {detecting && (
                                    <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <circle cx="12" cy="12" r="10" strokeOpacity="0.2" /><path d="M12 2a10 10 0 0 1 10 10" />
                                    </svg>
                                )}
                                {detecting ? "Detecting…" : "Next: Map Columns →"}
                            </button>
                        </div>
                    </>
                )}

                {/* ── Step 2: Map columns ── */}
                {step === "map" && detectResult && (
                    <>
                        <div className="px-6 pt-4 pb-2">
                            {/* Legend */}
                            <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
                                <span className="flex items-center gap-1.5">
                                    <span className="w-2 h-2 rounded-full bg-[var(--red)] inline-block" />
                                    Required
                                </span>
                                <span className="flex items-center gap-1.5">
                                    <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                                    Mapped
                                </span>
                                <span className="flex items-center gap-1.5">
                                    <span className="w-2 h-2 rounded-full bg-[var(--border)] inline-block" />
                                    Ignored
                                </span>
                            </div>
                        </div>

                        {/* Mapping table */}
                        <div className="overflow-y-auto" style={{ maxHeight: "340px" }}>
                            <table className="w-full text-sm border-collapse">
                                <thead className="sticky top-0 bg-[var(--surface)] z-10">
                                    <tr className="border-b border-[var(--border)]">
                                        <th className="text-left px-6 py-2.5 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-widest w-1/3">CSV Column</th>
                                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-widest w-1/3">Example</th>
                                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-widest w-1/3">Import as</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[var(--border)]">
                                    {detectResult.columns.map((col) => {
                                        const mapped = mappings[col] ?? "ignore";
                                        const isIgnored = !mapped || mapped === "ignore";
                                        const isRequired = REQUIRED_FIELDS.has(mapped);
                                        const exampleVal = detectResult.preview[0]?.[col] ?? "";

                                        return (
                                            <tr key={col} className={`transition-colors ${isIgnored ? "opacity-50" : "opacity-100"}`}>
                                                {/* Column name */}
                                                <td className="px-6 py-2.5">
                                                    <div className="flex items-center gap-2">
                                                        <span
                                                            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                                            style={{
                                                                background: isIgnored
                                                                    ? "var(--border)"
                                                                    : isRequired
                                                                        ? "var(--red)"
                                                                        : "rgb(52 211 153)",
                                                            }}
                                                        />
                                                        <span className="font-medium text-[var(--text-primary)] truncate" title={col}>{col}</span>
                                                    </div>
                                                </td>

                                                {/* Example value */}
                                                <td className="px-4 py-2.5 text-[var(--text-muted)] text-xs truncate max-w-[140px]" title={exampleVal}>
                                                    {exampleVal || <em className="opacity-40">empty</em>}
                                                </td>

                                                {/* Mapping dropdown */}
                                                <td className="px-4 py-2.5">
                                                    <select
                                                        value={mapped}
                                                        onChange={(e) => setMappings((prev) => ({ ...prev, [col]: e.target.value }))}
                                                        aria-label={`Map column ${col}`}
                                                        className="w-full px-2 py-1.5 text-xs bg-[var(--surface-2)] border border-[var(--border)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-red)] focus:ring-1 focus:ring-[var(--red)] transition-colors"
                                                    >
                                                        {FIELD_OPTIONS.map((opt) => (
                                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                        ))}
                                                    </select>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {!hasMandatoryMapping ? (
                            <div className="mx-6 mt-3 text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">
                                Map at least <strong>Company Name</strong>, <strong>Website</strong>, or <strong>Email</strong> to proceed
                            </div>
                        ) : !hasCompanyNameMapping && hasWebsiteOrEmailMapping ? (
                            <div className="mx-6 mt-3 text-xs text-blue-400 bg-blue-400/10 border border-blue-400/20 rounded-lg px-3 py-2 flex items-center gap-1.5">
                                <span>💡</span>
                                <span>Company Name will be automatically resolved from Website or Email domain.</span>
                            </div>
                        ) : null}

                        {error && (
                            <p role="alert" className="mx-6 mt-3 text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</p>
                        )}

                        <div className="flex gap-3 px-6 py-4 border-t border-[var(--border)] mt-3">
                            <button
                                onClick={() => { setStep("upload"); setError(null); }}
                                className="h-9 px-4 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] flex items-center gap-1.5"
                            >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <polyline points="15 18 9 12 15 6" />
                                </svg>
                                Back
                            </button>
                            <button
                                id="csv-import-btn"
                                onClick={handleImport}
                                disabled={importing || !hasMandatoryMapping}
                                className="flex-1 h-9 rounded-lg bg-[var(--red)] text-white text-sm font-semibold hover:bg-[var(--red-dim)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] flex items-center justify-center gap-2"
                            >
                                {importing && (
                                    <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <circle cx="12" cy="12" r="10" strokeOpacity="0.2" /><path d="M12 2a10 10 0 0 1 10 10" />
                                    </svg>
                                )}
                                {importing
                                    ? "Importing…"
                                    : `Import ${detectResult.totalRows.toLocaleString()} rows`}
                            </button>
                        </div>
                    </>
                )}

                {/* ── Step 3: Done ── */}
                {step === "done" && result && (
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
                                        { label: "created", val: result.created,  cls: "text-emerald-400" },
                                        { label: "skipped", val: result.skipped,  cls: "text-[var(--text-muted)]" },
                                        { label: "invalid", val: result.invalid,  cls: "text-amber-400" },
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
                )}
            </div>
        </dialog>
    );
}