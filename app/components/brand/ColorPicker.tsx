"use client";

import { useRef } from "react";

interface ColourPickerProps {
    id?: string;
    value: string;
    onChange: (hex: string) => void;
    error?: string;
    disabled?: boolean;
}

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function ColourPicker({
    id,
    value,
    onChange,
    error,
    disabled,
}: ColourPickerProps) {
    const swatchRef = useRef<HTMLInputElement>(null);
    const isValid = HEX_RE.test(value);

    const handleTextChange = (raw: string) => {
        const normalized = raw.startsWith("#") ? raw : `#${raw}`;
        onChange(normalized);
    };

    const handleSwatchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        onChange(e.target.value);
    };

    return (
        <div className="flex items-center gap-2">
            <button
                type="button"
                onClick={() => swatchRef.current?.click()}
                disabled={disabled}
                aria-label={`Pick colour, current value ${value}`}
                style={{ backgroundColor: isValid ? value : "#888" }}
                className={[
                    "w-9 h-9 rounded-lg border-2 flex-shrink-0 transition-transform duration-150",
                    "hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                    error ? "border-red-500/60" : "border-[var(--border)]",
                ].join(" ")}
            />
            <input
                ref={swatchRef}
                type="color"
                value={isValid ? value : "#888888"}
                onChange={handleSwatchChange}
                disabled={disabled}
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
            />
            <input
                id={id}
                type="text"
                value={value}
                onChange={(e) => handleTextChange(e.target.value)}
                onBlur={(e) => {
                    const v = e.target.value.trim();
                    onChange(v.startsWith("#") ? v : `#${v}`);
                }}
                disabled={disabled}
                maxLength={7}
                placeholder="#000000"
                aria-label="Hex colour value"
                className={[
                    "w-28 h-9 rounded-lg border bg-[var(--surface)] text-sm text-[var(--text-primary)]",
                    "placeholder:text-[var(--text-muted)] px-3 font-mono",
                    "focus:outline-none focus:ring-2 focus:ring-[var(--red)] focus:border-transparent",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                    error ? "border-red-500/60" : "border-[var(--border)]",
                ].join(" ")}
            />
            {error && (
                <p role="alert" className="text-xs text-red-400 sr-only">
                    {error}
                </p>
            )}
        </div>
    );
}