"use client";

import type { BrandSettingsInput } from "@/app/api/brand/brand.api";
import { BrandField } from "./BrandField";
import { ColourPicker } from "./ColorPicker";

interface ColoursSectionProps {
    form: BrandSettingsInput;
    errors: Record<string, string>;
    onChange: <K extends keyof BrandSettingsInput>(
        key: K,
        value: BrandSettingsInput[K]
    ) => void;
    disabled?: boolean;
}

export function ColoursSection({
    form,
    errors,
    onChange,
    disabled,
}: ColoursSectionProps) {
    return (
        <section aria-labelledby="colours-heading" className="space-y-4">
            <h3
                id="colours-heading"
                className="text-sm font-semibold font-display text-[var(--text-primary)]"
            >
                Colours
            </h3>

            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                <BrandField
                    label="Primary"
                    htmlFor="primaryColour"
                    error={errors.primaryColour}
                    hint="Email header background"
                    required
                >
                    <ColourPicker
                        id="primaryColour"
                        value={form.primaryColour}
                        onChange={(v) => onChange("primaryColour", v)}
                        error={errors.primaryColour}
                        disabled={disabled}
                    />
                </BrandField>

                <BrandField
                    label="Secondary"
                    htmlFor="secondaryColour"
                    error={errors.secondaryColour}
                    hint="Accent bars, footer strip"
                    required
                >
                    <ColourPicker
                        id="secondaryColour"
                        value={form.secondaryColour}
                        onChange={(v) => onChange("secondaryColour", v)}
                        error={errors.secondaryColour}
                        disabled={disabled}
                    />
                </BrandField>

                <BrandField
                    label="Accent"
                    htmlFor="accentColour"
                    error={errors.accentColour}
                    hint="CTA button — falls back to secondary"
                >
                    <ColourPicker
                        id="accentColour"
                        value={form.accentColour ?? form.secondaryColour}
                        onChange={(v) => onChange("accentColour", v)}
                        error={errors.accentColour}
                        disabled={disabled}
                    />
                </BrandField>

                <BrandField
                    label="Text"
                    htmlFor="textColour"
                    error={errors.textColour}
                    hint="Main body copy colour"
                    required
                >
                    <ColourPicker
                        id="textColour"
                        value={form.textColour}
                        onChange={(v) => onChange("textColour", v)}
                        error={errors.textColour}
                        disabled={disabled}
                    />
                </BrandField>

                <BrandField
                    label="Background"
                    htmlFor="backgroundColour"
                    error={errors.backgroundColour}
                    hint="Email body background"
                    required
                >
                    <ColourPicker
                        id="backgroundColour"
                        value={form.backgroundColour}
                        onChange={(v) => onChange("backgroundColour", v)}
                        error={errors.backgroundColour}
                        disabled={disabled}
                    />
                </BrandField>
            </div>
        </section>
    );
}