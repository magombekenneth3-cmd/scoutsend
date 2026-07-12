"use client";

import type { BrandSettingsInput } from "@/app/api/brand/brand.api";
import { BrandField, BrandInput, BrandTextarea } from "./BrandField";

interface FooterSectionProps {
    form: BrandSettingsInput;
    errors: Record<string, string>;
    onChange: <K extends keyof BrandSettingsInput>(
        key: K,
        value: BrandSettingsInput[K]
    ) => void;
    disabled?: boolean;
}

export function FooterSection({
    form,
    errors,
    onChange,
    disabled,
}: FooterSectionProps) {
    return (
        <section aria-labelledby="footer-heading" className="space-y-4">
            <h3
                id="footer-heading"
                className="text-sm font-semibold font-display text-[var(--text-primary)]"
            >
                Footer
            </h3>

            <BrandField
                label="Company Address"
                htmlFor="companyAddress"
                hint="Physical address shown in footer — recommended for CAN-SPAM compliance"
            >
                <BrandInput
                    id="companyAddress"
                    value={form.companyAddress ?? ""}
                    onChange={(e) => onChange("companyAddress", e.target.value)}
                    placeholder="123 Main St, Kampala, Uganda"
                    maxLength={300}
                    disabled={disabled}
                />
            </BrandField>

            <BrandField
                label="Unsubscribe Text"
                htmlFor="unsubscribeText"
                hint="Required — shown at the bottom of every email"
                required
            >
                <BrandTextarea
                    id="unsubscribeText"
                    value={form.unsubscribeText}
                    onChange={(e) => onChange("unsubscribeText", e.target.value)}
                    rows={2}
                    maxLength={500}
                    disabled={disabled}
                    aria-required="true"
                />
            </BrandField>

            <div className="grid grid-cols-1 gap-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mt-1">
                    Social Links
                </h4>

                <BrandField
                    label="LinkedIn"
                    htmlFor="linkedinUrl"
                    error={errors.linkedinUrl}
                >
                    <BrandInput
                        id="linkedinUrl"
                        type="url"
                        value={form.linkedinUrl ?? ""}
                        onChange={(e) => onChange("linkedinUrl", e.target.value)}
                        placeholder="https://linkedin.com/company/acme"
                        disabled={disabled}
                        error={!!errors.linkedinUrl}
                    />
                </BrandField>

                <BrandField
                    label="Facebook"
                    htmlFor="facebookUrl"
                    error={errors.facebookUrl}
                >
                    <BrandInput
                        id="facebookUrl"
                        type="url"
                        value={form.facebookUrl ?? ""}
                        onChange={(e) => onChange("facebookUrl", e.target.value)}
                        placeholder="https://facebook.com/acme"
                        disabled={disabled}
                        error={!!errors.facebookUrl}
                    />
                </BrandField>

                <BrandField
                    label="Twitter / X"
                    htmlFor="twitterUrl"
                    error={errors.twitterUrl}
                >
                    <BrandInput
                        id="twitterUrl"
                        type="url"
                        value={form.twitterUrl ?? ""}
                        onChange={(e) => onChange("twitterUrl", e.target.value)}
                        placeholder="https://twitter.com/acme"
                        disabled={disabled}
                        error={!!errors.twitterUrl}
                    />
                </BrandField>
            </div>
        </section>
    );
}