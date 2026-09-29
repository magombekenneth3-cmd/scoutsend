"use client";

export function AuthDivider() {
    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                margin: "18px 0",
            }}
        >
            <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>or</span>
            <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
        </div>
    );
}