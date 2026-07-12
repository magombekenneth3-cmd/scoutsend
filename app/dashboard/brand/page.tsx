"use client";

import { TopBar } from "@/app/components/dashboard/TopBar";
import { IdentitySection } from "@/app/components/brand/Identity";
import { ColoursSection } from "@/app/components/brand/ColorSeletion";
import { SignatureSection } from "@/app/components/brand/SignatureSection";
import { FooterSection } from "@/app/components/brand/FooterSection";
import { EmailPreview } from "@/app/components/brand/EmailPreview";
import { useBrand } from "@/app/api/brand/usebrand";

function SectionDivider() {
    return <div className="border-t border-[var(--border)]" />;
}

function SaveBar({
    isDirty,
    isSaving,
    saveSuccess,
    saveError,
    hasErrors,
    onSave,
}: {
    isDirty: boolean;
    isSaving: boolean;
    saveSuccess: boolean;
    saveError: string | null;
    hasErrors: boolean;
    onSave: () => void;
}) {
    if (!isDirty && !saveSuccess && !saveError && !hasErrors) return null;

    return (
        <div
            className={[
                "flex items-center justify-between px-5 py-3 border-t border-[var(--border)]",
                "bg-[var(--navy-mid)] flex-shrink-0",
            ].join(" ")}
            role="status"
            aria-live="polite"
        >
            <div className="flex items-center gap-2 text-sm">
                {saveSuccess && (
                    <span className="flex items-center gap-2 text-emerald-400">
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
                            <polyline points="20 6 9 17 4 12" />
                        </svg>
                        Saved
                    </span>
                )}
                {saveError && (
                    <span className="text-red-400">{saveError}</span>
                )}
                {isDirty && !saveSuccess && !saveError && (
                    <span className="text-[var(--text-muted)]">Unsaved changes</span>
                )}
            </div>

            {(isDirty || hasErrors) && (
                <button
                    onClick={onSave}
                    disabled={isSaving}
                    aria-disabled={isSaving}
                    className={[
                        "h-9 px-5 rounded-lg text-sm font-semibold font-display text-white transition-all duration-150",
                        "bg-[var(--red)] hover:bg-[var(--red-dim)]",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--navy-mid)]",
                        "disabled:opacity-50 disabled:cursor-not-allowed",
                    ].join(" ")}
                >
                    {isSaving ? "Saving…" : "Save Changes"}
                </button>
            )}
        </div>
    );
}

export default function BrandSettingsPage() {
    const {
        form,
        errors,
        updateField,
        save,
        isSaving,
        saveSuccess,
        saveError,
        loadingInitial,
        loadError,
        configured,
        isDirty,
        previewKey,
    } = useBrand();

    const hasErrors = Object.keys(errors).length > 0;

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <TopBar
                title="Brand Settings"
                subtitle="Control how your emails look to recipients"
                actions={
                    <button
                        onClick={() => save()}
                        disabled={isSaving}
                        aria-disabled={isSaving}
                        className={[
                            "h-9 px-4 rounded-lg text-sm font-semibold font-display text-white transition-all duration-150",
                            "bg-[var(--red)] hover:bg-[var(--red-dim)]",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]",
                            "disabled:opacity-40 disabled:cursor-not-allowed",
                        ].join(" ")}
                    >
                        {isSaving ? "Saving…" : "Save"}
                    </button>
                }
            />

            {loadError && (
                <div
                    role="alert"
                    className="mx-6 mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400 flex-shrink-0"
                >
                    {loadError}
                </div>
            )}

            {hasErrors && (
                <div
                    role="alert"
                    className="mx-6 mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 flex-shrink-0"
                    id="form-errors"
                >
                    <p className="text-sm font-medium text-red-400 mb-1">
                        Fix the following errors before saving:
                    </p>
                    <ul className="list-disc list-inside space-y-0.5">
                        {Object.entries(errors).map(([field, msg]) => (
                            <li key={field} className="text-xs text-red-300">
                                <a
                                    href={`#${field}`}
                                    className="underline hover:text-red-200"
                                >
                                    {field}
                                </a>
                                : {msg}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <div className="flex flex-1 min-h-0 overflow-hidden">
                <div className="flex flex-col w-[480px] flex-shrink-0 border-r border-[var(--border)] overflow-hidden">
                    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
                        {loadingInitial ? (
                            <div className="space-y-6 animate-pulse">
                                {Array.from({ length: 6 }).map((_, i) => (
                                    <div key={i} className="space-y-2">
                                        <div className="h-3 w-24 rounded bg-[var(--surface-2)]" />
                                        <div className="h-9 rounded-lg bg-[var(--surface-2)]" />
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <>
                                <IdentitySection
                                    form={form}
                                    errors={errors}
                                    onChange={updateField}
                                    disabled={isSaving}
                                />
                                <SectionDivider />
                                <ColoursSection
                                    form={form}
                                    errors={errors}
                                    onChange={updateField}
                                    disabled={isSaving}
                                />
                                <SectionDivider />
                                <SignatureSection
                                    form={form}
                                    errors={errors}
                                    onChange={updateField}
                                    disabled={isSaving}
                                />
                                <SectionDivider />
                                <FooterSection
                                    form={form}
                                    errors={errors}
                                    onChange={updateField}
                                    disabled={isSaving}
                                />
                            </>
                        )}
                    </div>

                    <SaveBar
                        isDirty={isDirty}
                        isSaving={isSaving}
                        saveSuccess={saveSuccess}
                        saveError={saveError}
                        hasErrors={hasErrors}
                        onSave={save}
                    />
                </div>

                <div className="flex-1 min-w-0 overflow-hidden">
                    <EmailPreview previewKey={previewKey} configured={configured} />
                </div>
            </div>
        </div>
    );
}