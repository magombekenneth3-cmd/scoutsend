"use client";

import React from "react";
import type { ProvenStat, BrandSettingsInput } from "@/app/api/brand/brand.api";

const MAX_STATS = 5;

const inputCls =
    "w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-red)] focus:ring-1 focus:ring-[var(--red)]/20 transition-colors";

export function ProvenStatsSection({
    form,
    onChange,
    disabled,
}: {
    form: BrandSettingsInput;
    onChange: <K extends keyof BrandSettingsInput>(key: K, value: BrandSettingsInput[K]) => void;
    disabled?: boolean;
}) {
    const stats: ProvenStat[] = Array.isArray(form.provenStats) ? form.provenStats : [];

    function update(next: ProvenStat[]) {
        onChange("provenStats", next.length > 0 ? next : null);
    }

    function addRow() {
        if (stats.length >= MAX_STATS) return;
        update([...stats, { metric: "", value: "", context: "" }]);
    }

    function removeRow(idx: number) {
        update(stats.filter((_, i) => i !== idx));
    }

    function updateRow(idx: number, field: keyof ProvenStat, val: string) {
        update(stats.map((s, i) => i === idx ? { ...s, [field]: val } : s));
    }

    return (
        <section aria-labelledby="proven-stats-heading" className="space-y-4">
            <div>
                <h2
                    id="proven-stats-heading"
                    className="text-sm font-semibold text-[var(--text-primary)]"
                >
                    Org-Level Proof Points
                </h2>
                <p className="text-[11px] text-[var(--text-muted)] mt-1 leading-relaxed">
                    Real, verified stats your AI will cite verbatim in emails — one per email,
                    never altered. These act as the fallback for all campaigns that don&apos;t
                    define their own proof points. If left empty, the AI uses qualitative language
                    instead of inventing numbers.
                </p>
            </div>

            <div className="space-y-3">
                {stats.length === 0 && (
                    <p className="text-xs text-[var(--text-muted)] italic">
                        No org-level proof points yet. Add up to {MAX_STATS}.
                    </p>
                )}

                {stats.map((stat, idx) => (
                    <div
                        key={idx}
                        className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-start"
                    >
                        <div>
                            {idx === 0 && (
                                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">
                                    Metric
                                </span>
                            )}
                            <input
                                type="text"
                                placeholder="e.g. Reply rate increase"
                                value={stat.metric}
                                disabled={disabled}
                                onChange={e => updateRow(idx, "metric", e.target.value)}
                                className={inputCls}
                                aria-label={`Org proof point ${idx + 1} metric`}
                            />
                        </div>

                        <div>
                            {idx === 0 && (
                                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">
                                    Value
                                </span>
                            )}
                            <input
                                type="text"
                                placeholder="e.g. 34%"
                                value={stat.value}
                                disabled={disabled}
                                onChange={e => updateRow(idx, "value", e.target.value)}
                                className={inputCls}
                                aria-label={`Org proof point ${idx + 1} value`}
                            />
                        </div>

                        <div>
                            {idx === 0 && (
                                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">
                                    Context
                                </span>
                            )}
                            <input
                                type="text"
                                placeholder="e.g. avg across SaaS pilots, last 90 days"
                                value={stat.context}
                                disabled={disabled}
                                onChange={e => updateRow(idx, "context", e.target.value)}
                                className={inputCls}
                                aria-label={`Org proof point ${idx + 1} context`}
                            />
                        </div>

                        <button
                            type="button"
                            onClick={() => removeRow(idx)}
                            disabled={disabled}
                            className={`p-1.5 rounded hover:bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--red-text)] transition-colors flex-shrink-0 disabled:opacity-40 ${idx === 0 ? "mt-5" : ""}`}
                            aria-label={`Remove org proof point ${idx + 1}`}
                        >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        </button>
                    </div>
                ))}

                {stats.length < MAX_STATS && (
                    <button
                        type="button"
                        onClick={addRow}
                        disabled={disabled}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--red-text)] hover:text-white transition-colors disabled:opacity-40"
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        Add proof point ({stats.length}/{MAX_STATS})
                    </button>
                )}
            </div>
        </section>
    );
}
