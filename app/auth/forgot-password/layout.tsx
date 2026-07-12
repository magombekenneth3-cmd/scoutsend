import type { Metadata } from "next";
import { AuthShell } from "@/app/components/authShell";

export const metadata: Metadata = {
    title: "Forgot password — ScoutSend",
};

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
    return (
        <>


            <main
                style={{
                    minHeight: "100vh",
                    background: "#1a1a2e",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "24px 16px",
                    fontFamily: "var(--ss-font-body)",
                    position: "relative",
                }}
            >
                {/* Background grid */}
                <div
                    aria-hidden
                    style={{
                        position: "fixed",
                        inset: 0,
                        backgroundImage:
                            "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
                        backgroundSize: "60px 60px",
                        maskImage: "radial-gradient(ellipse 80% 70% at 50% 50%, black, transparent)",
                        pointerEvents: "none",
                    }}
                />

                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        width: "100%",
                        maxWidth: 920,
                        borderRadius: 20,
                        overflow: "hidden",
                        border: "1px solid rgba(255,255,255,0.07)",
                        position: "relative",
                        zIndex: 1,
                    }}
                >
                    <AuthShell />

                    {/* Right panel — form slot */}
                    <div
                        style={{
                            background: "#1a1a2e",
                            padding: "48px 40px",
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "center",
                        }}
                    >
                        {children}
                    </div>
                </div>
            </main>
        </>
    );
}