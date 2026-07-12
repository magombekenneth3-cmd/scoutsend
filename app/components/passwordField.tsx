"use client";

import { useState } from "react";
import { InputField } from "./input";
import { getPasswordStrength } from "../api/src/lib/helper";

interface PasswordFieldProps {
    id: string;
    label?: string;
    placeholder?: string;
    value: string;
    onChange: (v: string) => void;
    onBlur?: () => void;
    error?: string;
    valid?: boolean;
    showStrength?: boolean;
    autoComplete?: string;
}

export function PasswordField({
    id,
    label = "Password",
    placeholder = "Min. 8 characters",
    value,
    onChange,
    onBlur,
    error,
    valid,
    showStrength = false,
    autoComplete = "current-password",
}: PasswordFieldProps) {
    const [visible, setVisible] = useState(false);
    const strength = showStrength && value.length > 0 ? getPasswordStrength(value) : null;

    return (
        <div>
            <InputField
                id={id}
                label={label}
                type={visible ? "text" : "password"}
                placeholder={placeholder}
                value={value}
                onChange={onChange}
                onBlur={onBlur}
                error={error}
                valid={valid}
                autoComplete={autoComplete}
                rightSlot={
                    <button
                        type="button"
                        onClick={() => setVisible((v) => !v)}
                        aria-label={visible ? "Hide password" : "Show password"}
                        style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            color: "#8892b0",
                            padding: 0,
                            display: "flex",
                            alignItems: "center",
                            fontSize: 15,
                            lineHeight: 1,
                        }}
                    >
                        {visible ? (
                            /* eye-off */
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                                <line x1="1" y1="1" x2="23" y2="23" />
                            </svg>
                        ) : (
                            /* eye */
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                <circle cx="12" cy="12" r="3" />
                            </svg>
                        )}
                    </button>
                }
            />

            {strength && (
                <div style={{ marginTop: 8 }}>
                    <div style={{ height: 3, borderRadius: 2, background: "#252b4a", overflow: "hidden" }}>
                        <div
                            style={{
                                height: "100%",
                                borderRadius: 2,
                                width: strength.pct,
                                background: strength.color,
                                transition: "width 0.3s, background 0.3s",
                            }}
                        />
                    </div>
                    <p style={{ fontSize: 11, color: strength.color, marginTop: 4 }}>
                        {strength.label}
                    </p>
                </div>
            )}
        </div>
    );
}