"use client";

import { AuthShell } from "./authShell";

/**
 * Responsive auth layout wrapper.
 * - Mobile (< 640px): single-column, compact logo header + form only
 * - Desktop (≥ 640px): two-column side-by-side (left panel + form)
 */
export function AuthLayoutShell({ children }: { children: React.ReactNode }) {
    return (
        <main className="auth-shell-main">
            {/* Background dot grid */}
            <div
                aria-hidden
                className="auth-shell-bg"
            />

            {/* Mobile logo strip — only visible below sm */}
            <div className="auth-mobile-logo" aria-label="ScoutSend">
                <div className="auth-mobile-logo-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" stroke="#fff" strokeWidth="1.5" />
                        <circle cx="12" cy="12" r="5" stroke="#fff" strokeWidth="1.5" />
                        <circle cx="12" cy="12" r="1.5" fill="#fff" />
                        <line x1="12" y1="2" x2="12" y2="7" stroke="#fff" strokeWidth="1.5" />
                        <line x1="12" y1="17" x2="12" y2="22" stroke="#fff" strokeWidth="1.5" />
                    </svg>
                </div>
                <span className="auth-mobile-logo-name">
                    Scout<span style={{ color: "#f43f5e" }}>Send</span>
                </span>
            </div>

            {/* Card wrapper */}
            <div className="auth-shell-card">
                {/* Left panel — hidden on mobile */}
                <div className="auth-shell-left">
                    <AuthShell />
                </div>

                {/* Right panel — form */}
                <div className="auth-shell-right">
                    {children}
                </div>
            </div>

            <style>{`
                .auth-shell-main {
                    min-height: 100vh;
                    background: var(--background);
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 16px;
                    font-family: var(--ss-font-body);
                    position: relative;
                    gap: 0;
                }

                .auth-shell-bg {
                    position: fixed;
                    inset: 0;
                    background-image:
                        linear-gradient(var(--glass-border) 1px, transparent 1px),
                        linear-gradient(90deg, var(--glass-border) 1px, transparent 1px);
                    background-size: 60px 60px;
                    mask-image: radial-gradient(ellipse 80% 70% at 50% 50%, black, transparent);
                    -webkit-mask-image: radial-gradient(ellipse 80% 70% at 50% 50%, black, transparent);
                    pointer-events: none;
                }

                /* Mobile logo bar */
                .auth-mobile-logo {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-bottom: 16px;
                    position: relative;
                    z-index: 2;
                }

                .auth-mobile-logo-icon {
                    width: 32px;
                    height: 32px;
                    border-radius: 8px;
                    background: #f43f5e;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 0 14px rgba(244,63,94,0.4);
                    flex-shrink: 0;
                }

                .auth-mobile-logo-name {
                    font-family: var(--font-display);
                    font-weight: 700;
                    font-size: 18px;
                    color: var(--text-primary);
                    letter-spacing: -0.02em;
                }

                /* Two-column card */
                .auth-shell-card {
                    display: grid;
                    grid-template-columns: 1fr;
                    width: 100%;
                    max-width: 480px;
                    border-radius: 16px;
                    overflow: hidden;
                    border: 1px solid var(--border);
                    box-shadow: 0 24px 60px rgba(0,0,0,0.4);
                    position: relative;
                    z-index: 1;
                }

                /* Hide the full left panel on mobile — we show the logo bar instead */
                .auth-shell-left {
                    display: none;
                }

                .auth-shell-right {
                    background: var(--surface);
                    padding: 28px 24px 32px;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                }

                /* Desktop: show two columns, hide the logo bar */
                @media (min-width: 640px) {
                    .auth-shell-main {
                        padding: 24px 16px;
                    }

                    .auth-mobile-logo {
                        display: none;
                    }

                    .auth-shell-card {
                        grid-template-columns: 1fr 1fr;
                        max-width: 920px;
                        border-radius: 20px;
                    }

                    .auth-shell-left {
                        display: block;
                    }

                    .auth-shell-right {
                        padding: 48px 40px;
                    }
                }
            `}</style>
        </main>
    );
}
