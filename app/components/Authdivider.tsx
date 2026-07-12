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
            <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.07)" }} />
            <span style={{ fontSize: 12, color: "#4a5175" }}>or</span>
            <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.07)" }} />
        </div>
    );
}