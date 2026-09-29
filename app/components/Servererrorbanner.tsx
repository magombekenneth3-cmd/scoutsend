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
                background: "var(--danger-bg)",
                border: "1px solid var(--danger-border)",
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: 13,
                color: "var(--danger-text)",
                lineHeight: 1.5,
            }}
        >
            {message}
        </div>
    );
}