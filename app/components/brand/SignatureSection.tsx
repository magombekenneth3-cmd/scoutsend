"use client";

import type { BrandSettingsInput } from "@/app/api/brand/brand.api";
import { SAFE_FONT_STACKS } from "@/app/api/brand/brand.api";
import { BrandField, BrandInput, BrandSelect } from "./BrandField";

interface SignatureSectionProps {
    form: BrandSettingsInput;
    errors: Record<string, string>;
    onChange: <K extends keyof BrandSettingsInput>(
        key: K,
        value: BrandSettingsInput[K]
    ) => void;
    disabled?: boolean;
}

export function SignatureSection({
    form,
    errors,
    onChange,
    disabled,
}: SignatureSectionProps) {
    return (
        <section aria-labelledby="signature-heading" className="space-y-4">
            <h3
                id="signature-heading"
                className="text-sm font-semibold font-display text-[var(--text-primary)]"
            >
                Sender Signature
            </h3>

            <div className="grid grid-cols-2 gap-4">
                <BrandField
                    label="Sender Name"
                    htmlFor="senderName"
                    error={errors.senderName}
                    required
                >
                    <BrandInput
                        id="senderName"
                        value={form.senderName}
                        onChange={(e) => onChange("senderName", e.target.value)}
                        placeholder="James Sullivan"
                        disabled={disabled}
                        error={!!errors.senderName}
                        aria-required="true"
                    />
                </BrandField>

                <BrandField
                    label="Title"
                    htmlFor="senderTitle"
                    hint="e.g. Head of Growth"
                >
                    <BrandInput
                        id="senderTitle"
                        value={form.senderTitle ?? ""}
                        onChange={(e) => onChange("senderTitle", e.target.value)}
                        placeholder="Head of Growth"
                        maxLength={100}
                        disabled={disabled}
                    />
                </BrandField>

                <BrandField
                    label="Phone"
                    htmlFor="senderPhone"
                    hint="Shown below sender name in signature"
                >
                    <BrandInput
                        id="senderPhone"
                        type="tel"
                        value={form.senderPhone ?? ""}
                        onChange={(e) => onChange("senderPhone", e.target.value)}
                        placeholder="+256 700 000 000"
                        maxLength={30}
                        disabled={disabled}
                    />
                </BrandField>

                <BrandField
                    label="Email Font"
                    htmlFor="fontFamily"
                    hint="Web-safe only — custom fonts break in most email clients"
                >
                    <BrandSelect
                        id="fontFamily"
                        value={form.fontFamily}
                        onChange={(e) => onChange("fontFamily", e.target.value)}
                        disabled={disabled}
                    >
                        {SAFE_FONT_STACKS.map((f) => (
                            <option key={f} value={f} style={{ fontFamily: f }}>
                                {f.split(",")[0]}
                            </option>
                        ))}
                    </BrandSelect>
                </BrandField>
            </div>
        </section>
    );
}