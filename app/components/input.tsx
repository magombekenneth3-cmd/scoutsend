"use client";

interface InputFieldProps {
    id: string;
    label: string;
    type?: string;
    placeholder?: string;
    value: string;
    onChange: (v: string) => void;
    onBlur?: () => void;
    error?: string;
    autoComplete?: string;
    rightSlot?: React.ReactNode;
    valid?: boolean;
}

export function InputField({
    id,
    label,
    type = "text",
    placeholder,
    value,
    onChange,
    onBlur,
    error,
    autoComplete,
    rightSlot,
    valid,
}: InputFieldProps) {
    const borderColor = error
        ? "var(--danger-border)"
        : valid
            ? "var(--success-border)"
            : "var(--border)";

    const focusShadow = "0 0 0 3px var(--red-glow)";
    const validShadow = "0 0 0 3px var(--success-bg)";
    const errorShadow = "0 0 0 3px var(--danger-bg)";
    const restShadow = "none";

    const currentShadow = error ? errorShadow : valid ? validShadow : restShadow;

    return (
        <div>
            <label
                htmlFor={id}
                style={{
                    display: "block",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--text-secondary)",
                    marginBottom: 7,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase" as const,
                    fontFamily: "var(--font-display)",
                }}
            >
                {label}
            </label>
            <div style={{ position: "relative" }}>
                <input
                    id={id}
                    type={type}
                    placeholder={placeholder}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onBlur={onBlur}
                    autoComplete={autoComplete}
                    style={{
                        width: "100%",
                        height: 44,
                        background: "var(--surface)",
                        border: `1px solid ${borderColor}`,
                        borderRadius: 10,
                        color: "var(--text-primary)",
                        fontFamily: "var(--font-body)",
                        fontSize: 14,
                        padding: rightSlot ? "0 40px 0 14px" : "0 14px",
                        outline: "none",
                        transition: "border-color 0.2s, box-shadow 0.2s",
                        boxShadow: currentShadow,
                    }}
                    onFocus={(e) => {
                        e.currentTarget.style.borderColor = "var(--border-red)";
                        e.currentTarget.style.boxShadow = focusShadow;
                    }}
                    onBlurCapture={(e) => {
                        e.currentTarget.style.borderColor = borderColor;
                        e.currentTarget.style.boxShadow = currentShadow;
                    }}
                />
                {rightSlot && (
                    <div
                        style={{
                            position: "absolute",
                            right: 12,
                            top: "50%",
                            transform: "translateY(-50%)",
                        }}
                    >
                        {rightSlot}
                    </div>
                )}
            </div>
            {error && (
                <p style={{ fontSize: 12, color: "var(--danger)", marginTop: 5 }}>{error}</p>
            )}
        </div>
    );
}