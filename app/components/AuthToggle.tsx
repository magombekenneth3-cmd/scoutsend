"use client";

import Link from "next/link";

interface AuthToggleProps {
    current: "login" | "register";
}

export function AuthToggle({ current }: AuthToggleProps) {
    return (
        <div
            style={{
                display: "flex",
                background: "#1e2340",
                border: "1px solid rgba(255,255,255,0.07)",
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
                        style={{
                            flex: 1,
                            height: 36,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            borderRadius: 7,
                            fontSize: 13,
                            fontWeight: active ? 700 : 500,
                            fontFamily: active ? "var(--font-display)" : "var(--font-body)",
                            color: active ? "#f0f2ff" : "#8892b0",
                            background: active ? "rgba(233,69,96,0.15)" : "transparent",
                            border: active ? "1px solid rgba(233,69,96,0.3)" : "1px solid transparent",
                            textDecoration: "none",
                            transition: "all 0.2s",
                            letterSpacing: active ? "0.01em" : 0,
                        }}
                    >
                        {tab === "login" ? "Sign in" : "Create account"}
                    </Link>
                );
            })}
        </div>
    );
}