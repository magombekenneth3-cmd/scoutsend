"use client";

import type { BrandSettingsInput } from "@/app/api/brand/brand.api";
import { BrandField, BrandInput } from "./BrandField";

interface IdentitySectionProps {
    form: BrandSettingsInput;
    errors: Record<string, string>;
    onChange: <K extends keyof BrandSettingsInput>(
        key: K,
        value: BrandSettingsInput[K]
    ) => void;
    disabled?: boolean;
}

export function IdentitySection({
    form,
    errors,
    onChange,
    disabled,
}: IdentitySectionProps) {
    return (
        <section aria-labelledby="identity-heading" className="space-y-4">
            <h3
                id="identity-heading"
                className="text-sm font-semibold font-display text-[var(--text-primary)]"
            >
                Identity
            </h3>

            <div className="grid grid-cols-2 gap-4">
                <BrandField
                    label="Company Name"
                    htmlFor="companyName"
                    error={errors.companyName}
                    required
                >
                    <BrandInput
                        id="companyName"
                        value={form.companyName}
                        onChange={(e) => onChange("companyName", e.target.value)}
                        placeholder="Acme Corp"
                        disabled={disabled}
                        error={!!errors.companyName}
                        aria-required="true"
                        aria-describedby={errors.companyName ? "companyName-error" : undefined}
                    />
                </BrandField>

                <BrandField
                    label="Website"
                    htmlFor="website"
                    error={errors.website}
                    hint="Used in email footer and signature"
                >
                    <BrandInput
                        id="website"
                        type="url"
                        value={form.website ?? ""}
                        onChange={(e) => onChange("website", e.target.value)}
                        placeholder="https://acme.com"
                        disabled={disabled}
                        error={!!errors.website}
                    />
                </BrandField>
            </div>

            <BrandField
                label="Tagline"
                htmlFor="tagline"
                hint="Short phrase shown beside your logo in the email header"
            >
                <BrandInput
                    id="tagline"
                    value={form.tagline ?? ""}
                    onChange={(e) => onChange("tagline", e.target.value)}
                    placeholder="We help sales teams win"
                    maxLength={120}
                    disabled={disabled}
                />
            </BrandField>

            <BrandField
                label="Logo URL"
                htmlFor="logoUrl"
                error={errors.logoUrl}
                hint="Publicly accessible image URL — shown in email header and signature"
            >
                <div className="flex items-center gap-3">
                    {form.logoUrl && (
                        <div className="w-9 h-9 rounded-lg border border-[var(--border)] bg-white flex items-center justify-center flex-shrink-0 overflow-hidden">
                            <img
                                src={form.logoUrl}
                                alt="Logo preview"
                                className="max-w-full max-h-full object-contain"
                                onError={(e) => {
                                    (e.currentTarget as HTMLImageElement).style.display = "none";
                                }}
                            />
                        </div>
                    )}
                    <BrandInput
                        id="logoUrl"
                        type="url"
                        value={form.logoUrl ?? ""}
                        onChange={(e) => onChange("logoUrl", e.target.value)}
                        placeholder="https://acme.com/logo.png"
                        disabled={disabled}
                        error={!!errors.logoUrl}
                    />
                </div>
            </BrandField>
        </section>
    );
}