"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function ResetPasswordForm() {
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
                const data = await res.json();
                setError(data.error ?? "Something went wrong");
                return;
            }

            setDone(true);
            setTimeout(() => router.push("/auth/login"), 2000);
        } finally {
            setLoading(false);
        }
    }

    if (!token) {
        return <p>Invalid reset link. Please request a new one.</p>;
    }

    if (done) {
        return <p>Password updated! Redirecting to login…</p>;
    }

    return (
        <form onSubmit={handleSubmit}>
            <h1>Set a new password</h1>
            {error && <p style={{ color: "red" }}>{error}</p>}
            <input
                type="password"
                placeholder="New password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
            />
            <input
                type="password"
                placeholder="Confirm password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
            />
            <button type="submit" disabled={loading}>
                {loading ? "Saving…" : "Reset password"}
            </button>
        </form>
    );
}