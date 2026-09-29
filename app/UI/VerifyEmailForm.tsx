"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ServerErrorBanner } from "../components/Servererrorbanner";

type Status = "verifying" | "success" | "error" | "idle";

export function VerifyEmailForm() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const token = searchParams.get("token");

    const [status, setStatus] = useState<Status>(token ? "verifying" : "idle");
    const [serverError, setServerError] = useState<string | null>(null);
    const [resendMessage, setResendMessage] = useState<string | null>(null);
    const [isResending, setIsResending] = useState(false);

    useEffect(() => {
        if (!token) return;

        async function verify() {
            try {
                const res = await fetch("/api/auth/verify-email", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ token }),
                });

                const data = await res.json();
                if (!res.ok) {
                    setServerError(data.error ?? "Invalid or expired verification token.");
                    setStatus("error");
                    return;
                }

                setStatus("success");
                setTimeout(() => {
                    router.push("/dashboard");
                }, 1500);
            } catch {
                setServerError("Network error during verification.");
                setStatus("error");
            }
        }

        verify();
    }, [token, router]);

    async function handleResend() {
        setIsResending(true);
        setServerError(null);
        setResendMessage(null);

        try {
            const res = await fetch("/api/auth/resend-verification", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
            });

            const data = await res.json();
            if (!res.ok) {
                setServerError(data.error ?? "Failed to resend verification email.");
            } else {
                setResendMessage(data.message ?? "Verification email sent successfully! Please check your inbox.");
            }
        } catch {
            setServerError("Network error. Please try again.");
        } finally {
            setIsResending(false);
        }
    }

    if (status === "verifying") {
        return (
            <div style={{ textAlign: "center", padding: "32px 0" }}>
                <div style={{
                    width: 48, height: 48, borderRadius: "50%",
                    border: "3px solid var(--red-glow)",
                    borderTopColor: "var(--red)",
                    animation: "ss-spin 1s linear infinite",
                    margin: "0 auto 20px auto",
                }} />
                <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 24, color: "var(--text-primary)", marginBottom: 8 }}>
                    Verifying your email…
                </h1>
                <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>
                    Please wait a moment while we confirm your account.
                </p>
            </div>
        );
    }

    if (status === "success") {
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
                    Email Verified!
                </h1>
                <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 20 }}>
                    Your email address has been confirmed. Redirecting to your dashboard…
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
                    Email Verification Required
                </p>
                <h1 style={{
                    fontFamily: "var(--font-display)", fontWeight: 800,
                    fontSize: 26, color: "var(--text-primary)", letterSpacing: "-0.025em",
                    lineHeight: 1.15, marginBottom: 6,
                }}>
                    Verify your email address
                </h1>
                <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                    To access your ScoutSend account, please verify your email address using the link sent to your inbox.
                </p>
            </div>

            <ServerErrorBanner message={serverError} />

            {resendMessage && (
                <div style={{
                    background: "var(--success-bg)",
                    border: "1px solid var(--success-border)",
                    borderRadius: 10,
                    padding: "12px 16px",
                    color: "var(--success-text)",
                    fontSize: 13,
                    marginBottom: 16,
                }}>
                    {resendMessage}
                </div>
            )}

            <button
                type="button"
                onClick={handleResend}
                disabled={isResending}
                style={{
                    width: "100%", height: 48,
                    background: "var(--red)",
                    border: "none", borderRadius: 10,
                    color: "#fff", fontFamily: "var(--font-display)",
                    fontWeight: 700, fontSize: 15,
                    cursor: isResending ? "not-allowed" : "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    transition: "background 0.2s",
                    opacity: isResending ? 0.75 : 1,
                    marginBottom: 20,
                }}
            >
                {isResending ? "Sending verification email…" : "Resend Verification Email"}
            </button>

            <div style={{ textAlign: "center" }}>
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
