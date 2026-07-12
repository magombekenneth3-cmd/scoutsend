"use client";

import { useState, useId } from "react";
import { useRouter } from "next/navigation";
import { InputField } from "../components/input";
import { PasswordField } from "../components/passwordField";
import { GoogleButton } from "../components/GoogleButton";
import { AuthDivider } from "../components/Authdivider";
import { AuthToggle } from "../components/AuthToggle";
import { ServerErrorBanner } from "../components/Servererrorbanner";
import { validateRegister } from "../api/src/lib/helper";
import type { RegisterFieldError, FormStatus, AuthResponse } from "../api/src/lib/types";

export function RegisterForm() {
    const router = useRouter();
    const id = useId();

    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [agree, setAgree] = useState(false);

    const [errors, setErrors] = useState<RegisterFieldError>({});
    const [touched, setTouched] = useState<Record<string, boolean>>({});
    const [serverError, setServerError] = useState<string | null>(null);
    const [status, setStatus] = useState<FormStatus>("idle");

    function revalidate(overrides: Partial<{
        firstName: string; lastName: string;
        email: string; password: string; agree: boolean;
    }> = {}) {
        const result = validateRegister({
            firstName, lastName, email, password, agree,
            ...overrides,
        });
        setErrors(result);
        return result;
    }

    function touch(field: string, overrides = {}) {
        setTouched((prev) => ({ ...prev, [field]: true }));
        revalidate(overrides);
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setTouched({ firstName: true, lastName: true, email: true, password: true, agree: true });
        const result = revalidate();
        if (Object.keys(result).length > 0) return;

        setStatus("loading");
        setServerError(null);

        try {
            const res = await fetch("/api/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ firstName, lastName, email, password }),
            });

            const data: AuthResponse & { error?: string; message?: string } = await res.json();

            if (!res.ok) {
                setServerError(data.error ?? data.message ?? "Registration failed. Please try again.");
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
                    Get started free
                </p>
                <h1 style={{
                    fontFamily: "var(--font-display)", fontWeight: 800,
                    fontSize: 26, color: "#f0f2ff", letterSpacing: "-0.025em",
                    lineHeight: 1.15, marginBottom: 6,
                }}>
                    Create your account
                </h1>
                <p style={{ fontSize: 14, color: "#8892b0", lineHeight: 1.6 }}>
                    100 leads, 3 campaigns, no credit card.
                </p>
            </div>

            <AuthToggle current="register" />

            <form onSubmit={handleSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <InputField
                        id={`${id}-fname`}
                        label="First name"
                        placeholder="Amara"
                        value={firstName}
                        onChange={setFirstName}
                        onBlur={() => touch("firstName")}
                        error={touched.firstName ? errors.firstName : undefined}
                        valid={touched.firstName && !errors.firstName && firstName.length >= 2}
                        autoComplete="given-name"
                    />
                    <InputField
                        id={`${id}-lname`}
                        label="Last name"
                        placeholder="Nwosu"
                        value={lastName}
                        onChange={setLastName}
                        onBlur={() => touch("lastName")}
                        error={touched.lastName ? errors.lastName : undefined}
                        valid={touched.lastName && !errors.lastName && lastName.length >= 2}
                        autoComplete="family-name"
                    />
                </div>

                <InputField
                    id={`${id}-email`}
                    label="Work email"
                    type="email"
                    placeholder="amara@stackvault.io"
                    value={email}
                    onChange={setEmail}
                    onBlur={() => touch("email")}
                    error={touched.email ? errors.email : undefined}
                    valid={touched.email && !errors.email && email.length > 0}
                    autoComplete="email"
                />

                <PasswordField
                    id={`${id}-password`}
                    value={password}
                    onChange={setPassword}
                    onBlur={() => touch("password")}
                    error={touched.password ? errors.password : undefined}
                    valid={touched.password && !errors.password && password.length >= 8}
                    showStrength
                    autoComplete="new-password"
                />

                <div>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                        <input
                            id={`${id}-agree`}
                            type="checkbox"
                            checked={agree}
                            onChange={(e) => {
                                setAgree(e.target.checked);
                                if (touched.agree) touch("agree", { agree: e.target.checked });
                            }}
                            style={{ width: 16, height: 16, marginTop: 2, accentColor: "#e94560", flexShrink: 0, cursor: "pointer" }}
                        />
                        <label htmlFor={`${id}-agree`} style={{ fontSize: 13, color: "#8892b0", lineHeight: 1.5, cursor: "pointer" }}>
                            I agree to ScoutSend&apos;s{" "}
                            <a href="/terms" style={{ color: "#e94560", textDecoration: "none" }}>Terms of Service</a>{" "}
                            and{" "}
                            <a href="/privacy" style={{ color: "#e94560", textDecoration: "none" }}>Privacy Policy</a>
                        </label>
                    </div>
                    {touched.agree && errors.agree && (
                        <p style={{ fontSize: 12, color: "#f87171", marginTop: 5 }}>{errors.agree}</p>
                    )}
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
                        transition: "background 0.2s, transform 0.15s",
                        opacity: isLoading ? 0.75 : 1,
                        letterSpacing: "0.01em",
                    }}
                >
                    {isLoading && "Creating account…"}
                    {isSuccess && "✓ Account created!"}
                    {!isLoading && !isSuccess && (
                        <>
                            Create account
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M5 12h14M12 5l7 7-7 7" />
                            </svg>
                        </>
                    )}
                </button>
            </form>

            <AuthDivider />
            <GoogleButton label="Sign up with Google" />
        </div>
    );
}