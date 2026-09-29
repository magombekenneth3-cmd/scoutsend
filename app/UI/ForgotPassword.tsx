"use client";

import { useState, useId } from "react";
import Link from "next/link";
import { InputField } from "../components/input";
import { ServerErrorBanner } from "../components/Servererrorbanner";

type Status = "idle" | "loading" | "sent";

export function ForgotPasswordForm() {
    const id = useId();
    const [email, setEmail] = useState("");
    const [touched, setTouched] = useState(false);
    const [serverError, setServerError] = useState<string | null>(null);
    const [status, setStatus] = useState<Status>("idle");

    const emailError =
        touched && !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
            ? "Please enter a valid email address"
            : undefined;

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setTouched(true);
        if (emailError) return;

        setStatus("loading");
        setServerError(null);

        try {
            const res = await fetch("/api/auth/forgot-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email }),
            });

            // Always show the success state — never reveal whether an email
            // exists in the system (prevents user enumeration).
            if (!res.ok && res.status !== 404) {
                const data = await res.json().catch(() => ({}));
                setServerError(data.error ?? "Something went wrong. Please try again.");
                setStatus("idle");
                return;
            }

            setStatus("sent");
        } catch {
            setServerError("Network error. Please check your connection.");
            setStatus("idle");
        }
    }

    const isLoading = status === "loading";

    if (status === "sent") {
        return (
            <div>
                {/* Header */}
                <div style={{ marginBottom: 32 }}>
                    <p style={{
                        fontSize: 11, fontWeight: 700, letterSpacing: "0.1em",
                        textTransform: "uppercase", color: "var(--red)",
                        fontFamily: "var(--font-display)", marginBottom: 10,
                    }}>
                        Check your inbox
                    </p>
                    <h1 style={{
                        fontFamily: "var(--font-display)", fontWeight: 800,
                        fontSize: 26, color: "var(--text-primary)", letterSpacing: "-0.025em",
                        lineHeight: 1.15, marginBottom: 6,
                    }}>
                        Email sent
                    </h1>
                    <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                        If <strong style={{ color: "var(--text-primary)" }}>{email}</strong> is registered,
                        you'll receive a reset link shortly. It expires in 1 hour.
                    </p>
                </div>

                {/* Success card */}
                <div style={{
                    background: "var(--success-bg)",
                    border: "1px solid var(--success-border)",
                    borderRadius: 12,
                    padding: "20px 20px",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 14,
                    marginBottom: 28,
                }}>
                    <div style={{
                        width: 36, height: 36, borderRadius: "50%",
                        background: "var(--success-bg)",
                        border: "1px solid var(--success-border)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0,
                    }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                            stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                        </svg>
                    </div>
                    <div>
                        <p style={{ fontSize: 13, fontWeight: 600, color: "var(--success-text)", marginBottom: 4 }}>
                            Reset link sent
                        </p>
                        <p style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                            Can't see it? Check your spam folder or make sure the address is correct.
                        </p>
                    </div>
                </div>

                <Link
                    href="/auth/login"
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                        width: "100%",
                        height: 48,
                        background: "transparent",
                        border: "1px solid var(--border)",
                        borderRadius: 10,
                        color: "var(--text-secondary)",
                        fontFamily: "var(--font-display)",
                        fontWeight: 600,
                        fontSize: 14,
                        textDecoration: "none",
                        transition: "border-color 0.2s, color 0.2s",
                    }}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                    Back to sign in
                </Link>
            </div>
        );
    }

    return (
        <div>
            {/* Header */}
            <div style={{ marginBottom: 28 }}>
                <p style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: "0.1em",
                    textTransform: "uppercase", color: "var(--red)",
                    fontFamily: "var(--font-display)", marginBottom: 10,
                }}>
                    Account recovery
                </p>
                <h1 style={{
                    fontFamily: "var(--font-display)", fontWeight: 800,
                    fontSize: 26, color: "var(--text-primary)", letterSpacing: "-0.025em",
                    lineHeight: 1.15, marginBottom: 6,
                }}>
                    Forgot your password?
                </h1>
                <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                    Enter your email and we'll send you a reset link valid for 1 hour.
                </p>
            </div>

            <form onSubmit={handleSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <InputField
                    id={`${id}-email`}
                    label="Email"
                    type="email"
                    placeholder="amara@stackvault.io"
                    value={email}
                    onChange={setEmail}
                    onBlur={() => setTouched(true)}
                    error={emailError}
                    valid={touched && !emailError && email.length > 0}
                    autoComplete="email"
                />

                <ServerErrorBanner message={serverError} />

                <button
                    type="submit"
                    disabled={isLoading}
                    style={{
                        width: "100%", height: 48,
                        background: "var(--red)",
                        border: "none", borderRadius: 10,
                        color: "#fff", fontFamily: "var(--font-display)",
                        fontWeight: 700, fontSize: 15,
                        cursor: isLoading ? "not-allowed" : "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        transition: "background 0.2s",
                        opacity: isLoading ? 0.75 : 1,
                        letterSpacing: "0.01em",
                    }}
                >
                    {isLoading ? "Sending…" : (
                        <>
                            Send reset link
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                                stroke="currentColor" strokeWidth="2.5">
                                <path d="M5 12h14M12 5l7 7-7 7" />
                            </svg>
                        </>
                    )}
                </button>
            </form>

            {/* Back link */}
            <div style={{ marginTop: 24, textAlign: "center" }}>
                <Link
                    href="/auth/login"
                    style={{
                        fontSize: 13, color: "var(--text-secondary)", textDecoration: "none",
                        display: "inline-flex", alignItems: "center", gap: 6,
                    }}
                >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                    Back to sign in
                </Link>
            </div>
        </div>
    );
}