"use client";

import { useState, useId } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { PasswordField } from "../components/passwordField";
import { ServerErrorBanner } from "../components/Servererrorbanner";

export function ResetPasswordForm() {
    const id = useId();
    const params = useSearchParams();
    const token = params.get("token") ?? "";
    const router = useRouter();

    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [done, setDone] = useState(false);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError("");

        if (password !== confirm) {
            setError("Passwords do not match");
            return;
        }
        if (password.length < 8) {
            setError("Password must be at least 8 characters");
            return;
        }

        setLoading(true);
        try {
            const res = await fetch("/api/auth/reset-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token, password }),
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                setError(data.error ?? "Something went wrong. Please try again.");
                return;
            }

            setDone(true);
            setTimeout(() => router.push("/auth/login"), 2000);
        } catch {
            setError("Network error. Please check your connection.");
        } finally {
            setLoading(false);
        }
    }

    if (!token) {
        return (
            <div>
                <div style={{ marginBottom: 24 }}>
                    <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 24, color: "var(--text-primary)", marginBottom: 8 }}>
                        Invalid Link
                    </h1>
                    <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                        This password reset link is invalid or has expired. Please request a new link.
                    </p>
                </div>
                <Link
                    href="/auth/forgot-password"
                    style={{
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        width: "100%", height: 48, background: "var(--red)", borderRadius: 10,
                        color: "#fff", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, textDecoration: "none"
                    }}
                >
                    Request new reset link
                </Link>
            </div>
        );
    }

    if (done) {
        return (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
                <div style={{
                    width: 48, height: 48, borderRadius: "50%",
                    background: "var(--success-bg)",
                    border: "1px solid var(--success-border)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    margin: "0 auto 16px auto",
                }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                    </svg>
                </div>
                <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 24, color: "var(--text-primary)", marginBottom: 8 }}>
                    Password Updated!
                </h1>
                <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 20 }}>
                    Your password has been changed successfully. Redirecting to sign in…
                </p>
            </div>
        );
    }

    return (
        <div>
            <div style={{ marginBottom: 28 }}>
                <p style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: "0.1em",
                    textTransform: "uppercase", color: "var(--red)",
                    fontFamily: "var(--font-display)", marginBottom: 10,
                }}>
                    Security
                </p>
                <h1 style={{
                    fontFamily: "var(--font-display)", fontWeight: 800,
                    fontSize: 26, color: "var(--text-primary)", letterSpacing: "-0.025em",
                    lineHeight: 1.15, marginBottom: 6,
                }}>
                    Set a new password
                </h1>
                <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                    Choose a strong password with at least 8 characters.
                </p>
            </div>

            <form onSubmit={handleSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <PasswordField
                    id={`${id}-new-password`}
                    label="New Password"
                    placeholder="Min. 8 characters"
                    value={password}
                    onChange={setPassword}
                    showStrength
                    autoComplete="new-password"
                />

                <PasswordField
                    id={`${id}-confirm-password`}
                    label="Confirm Password"
                    placeholder="Re-enter new password"
                    value={confirm}
                    onChange={setConfirm}
                    autoComplete="new-password"
                />

                <ServerErrorBanner message={error} />

                <button
                    type="submit"
                    disabled={loading}
                    style={{
                        width: "100%", height: 48,
                        background: "var(--red)",
                        border: "none", borderRadius: 10,
                        color: "#fff", fontFamily: "var(--font-display)",
                        fontWeight: 700, fontSize: 15,
                        cursor: loading ? "not-allowed" : "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        transition: "background 0.2s",
                        opacity: loading ? 0.75 : 1,
                        letterSpacing: "0.01em",
                    }}
                >
                    {loading ? "Saving…" : "Reset password"}
                </button>
            </form>

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