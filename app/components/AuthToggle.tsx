"use client";

import Link from "next/link";

interface AuthToggleProps {
    current: "login" | "register";
}

export function AuthToggle({ current }: AuthToggleProps) {
    return (
        <div
            className="auth-toggle-track"
            style={{
                display: "flex",
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: 4,
                marginBottom: 28,
                gap: 4,
            }}
        >
            {(["login", "register"] as const).map((tab) => {
                const active = tab === current;
                return (
                    <Link
                        key={tab}
                        href={`/auth/${tab}`}
                        className={active ? "auth-toggle-tab auth-toggle-tab--active" : "auth-toggle-tab"}
                        style={{
                            flex: 1,
                            height: 36,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            borderRadius: 7,
                            fontSize: 13,
                            fontWeight: active ? 600 : 500,
                            fontFamily: "var(--font-body)",
                            textDecoration: "none",
                            transition: "all 0.2s",
                        }}
                    >
                        {tab === "login" ? "Sign in" : "Create account"}
                    </Link>
                );
            })}
        </div>
    );
}