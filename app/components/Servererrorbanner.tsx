"use client";

interface ServerErrorBannerProps {
    message: string | null;
}

export function ServerErrorBanner({ message }: ServerErrorBannerProps) {
    if (!message) return null;

    return (
        <div
            role="alert"
            style={{
                background: "rgba(248,113,113,0.08)",
                border: "1px solid rgba(248,113,113,0.3)",
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: 13,
                color: "#f87171",
                lineHeight: 1.5,
            }}
        >
            {message}
        </div>
    );
}