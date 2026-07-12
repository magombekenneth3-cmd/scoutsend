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
        ? "rgba(248,113,113,0.5)"
        : valid
            ? "rgba(34,197,94,0.35)"
            : "rgba(255,255,255,0.07)";

    const focusShadow = "0 0 0 3px rgba(233,69,96,0.08)";
    const validShadow = "0 0 0 3px rgba(34,197,94,0.06)";
    const errorShadow = "0 0 0 3px rgba(248,113,113,0.06)";
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
                    color: "#8892b0",
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
                        background: "#1e2340",
                        border: `1px solid ${borderColor}`,
                        borderRadius: 10,
                        color: "#f0f2ff",
                        fontFamily: "var(--font-body)",
                        fontSize: 14,
                        padding: rightSlot ? "0 40px 0 14px" : "0 14px",
                        outline: "none",
                        transition: "border-color 0.2s, box-shadow 0.2s",
                        boxShadow: currentShadow,
                    }}
                    onFocus={(e) => {
                        e.currentTarget.style.borderColor = "rgba(233,69,96,0.5)";
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
                <p style={{ fontSize: 12, color: "#f87171", marginTop: 5 }}>{error}</p>
            )}
        </div>
    );
}