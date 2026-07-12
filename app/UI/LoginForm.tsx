"use client";

import { useState, useId } from "react";
import { useRouter } from "next/navigation";
import { InputField } from "../components/input";
import { PasswordField } from "../components/passwordField";
import { GoogleButton } from "../components/GoogleButton";
import { AuthDivider } from "../components/Authdivider";
import { AuthToggle } from "../components/AuthToggle";
import { ServerErrorBanner } from "../components/Servererrorbanner";
import { validateLogin } from "../api/src/lib/helper";
import type { LoginFieldError, FormStatus, AuthResponse } from "../api/src/lib/types";

export function LoginForm() {
    const router = useRouter();
    const id = useId();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");

    const [errors, setErrors] = useState<LoginFieldError>({});
    const [touched, setTouched] = useState<Record<string, boolean>>({});
    const [serverError, setServerError] = useState<string | null>(null);
    const [status, setStatus] = useState<FormStatus>("idle");

    function revalidate(overrides: Partial<{ email: string; password: string }> = {}) {
        const result = validateLogin({ email, password, ...overrides });
        setErrors(result);
        return result;
    }

    function touch(field: string, overrides = {}) {
        setTouched((prev) => ({ ...prev, [field]: true }));
        revalidate(overrides);
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setTouched({ email: true, password: true });
        const result = revalidate();
        if (Object.keys(result).length > 0) return;

        setStatus("loading");
        setServerError(null);

        try {
            const res = await fetch("/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ email, password }),
            });

            const data: AuthResponse & { error?: string; message?: string } = await res.json();

            if (!res.ok) {
                setServerError(data.error ?? data.message ?? "Invalid email or password.");
                setStatus("idle");
                return;
            }

            setStatus("success");
            router.push("/dashboard");
        } catch {
            setServerError("Network error. Please check your connection.");
            setStatus("idle");
        }
    }

    const isLoading = status === "loading";
    const isSuccess = status === "success";

    return (
        <div>
            <div style={{ marginBottom: 28 }}>
                <p style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: "0.1em",
                    textTransform: "uppercase", color: "#e94560",
                    fontFamily: "var(--font-display)", marginBottom: 10,
                }}>
                    Welcome back
                </p>
                <h1 style={{
                    fontFamily: "var(--font-display)", fontWeight: 800,
                    fontSize: 26, color: "#f0f2ff", letterSpacing: "-0.025em",
                    lineHeight: 1.15, marginBottom: 6,
                }}>
                    Sign in to ScoutSend
                </h1>
                <p style={{ fontSize: 14, color: "#8892b0", lineHeight: 1.6 }}>
                    Continue building your pipeline.
                </p>
            </div>

            <AuthToggle current="login" />

            <form onSubmit={handleSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <InputField
                    id={`${id}-email`}
                    label="Email"
                    type="email"
                    placeholder="amara@stackvault.io"
                    value={email}
                    onChange={setEmail}
                    onBlur={() => touch("email")}
                    error={touched.email ? errors.email : undefined}
                    valid={touched.email && !errors.email && email.length > 0}
                    autoComplete="email"
                />

                <div>
                    <PasswordField
                        id={`${id}-password`}
                        value={password}
                        onChange={setPassword}
                        onBlur={() => touch("password")}
                        error={touched.password ? errors.password : undefined}
                        valid={touched.password && !errors.password && password.length > 0}
                        autoComplete="current-password"
                    />
                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                        <a
                            href="/auth/forgot-password"
                            style={{ fontSize: 12, color: "#e94560", textDecoration: "none" }}
                        >
                            Forgot password?
                        </a>
                    </div>
                </div>

                <ServerErrorBanner message={serverError} />

                <button
                    type="submit"
                    disabled={isLoading || isSuccess}
                    style={{
                        width: "100%", height: 48,
                        background: isSuccess ? "#22c55e" : "#e94560",
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
                    {isLoading && "Signing in…"}
                    {isSuccess && "✓ Signed in!"}
                    {!isLoading && !isSuccess && (
                        <>
                            Sign in
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M5 12h14M12 5l7 7-7 7" />
                            </svg>
                        </>
                    )}
                </button>
            </form>

            <AuthDivider />
            <GoogleButton label="Sign in with Google" />
        </div>
    );
}