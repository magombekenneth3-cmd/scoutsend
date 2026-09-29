"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "../components/dashboard/SideBar";
import { ToastRegion } from "../components/dashboard/ToastRegion";
import { UserContext, DashboardUser } from "../context/UserContext";
import { CampaignEventsProvider, useCampaignEventsContext, CampaignSSEEvent } from "../context/CampaignEventsContext";
import type { Toast } from "../hooks/useToast";

let _toastId = 0;

const NOTIFY_ON_COMPLETE = new Set([
    "poll-mailbox-replies",
    "send-batch",
]);

const NOTIFY_LABELS: Record<string, string> = {
    "poll-mailbox-replies": "New reply received",
    "send-batch": "Email batch sent",
};

function GlobalToastNotificationListener({ addToast }: { addToast: (type: Toast["type"], message: string) => void }) {
    const eventsCtx = useCampaignEventsContext();

    useEffect(() => {
        if (!eventsCtx) return;
        return eventsCtx.subscribe((event) => {
            if (event.type === "failed") {
                addToast("error", `${event.label} failed${event.detail ? `: ${event.detail}` : ""}`);
            } else if (event.type === "completed" && NOTIFY_ON_COMPLETE.has(event.jobName)) {
                const label = NOTIFY_LABELS[event.jobName] ?? event.label;
                addToast("success", label);
            }
        });
    }, [eventsCtx, addToast]);

    return null;
}

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const router = useRouter();
    const [user, setUser] = useState<DashboardUser | null>(null);
    const [collapsed, setCollapsed] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);

    const [authError, setAuthError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function loadUser() {
            try {
                let res = await fetch("/api/auth/me");

                if (res.status === 401) {
                    const body = await res.json().catch(() => ({})) as { code?: string };

                    if (body.code === "TOKEN_EXPIRED") {
                        const refreshRes = await fetch("/api/auth/refresh", { method: "POST" });
                        if (refreshRes.ok) {
                            res = await fetch("/api/auth/me");
                        } else {
                            if (!cancelled) router.replace("/auth/login");
                            return;
                        }
                    } else {
                        if (!cancelled) router.replace("/auth/login");
                        return;
                    }
                }

                if (res.status === 401) {
                    if (!cancelled) router.replace("/auth/login");
                    return;
                }

                if (!res.ok) {
                    if (!cancelled) setAuthError(`Server error (${res.status}) — try refreshing.`);
                    return;
                }

                const data = await res.json();
                if (cancelled) return;

                if (data.emailVerified === false) {
                    router.replace("/auth/verify-email");
                    return;
                }

                setUser(data as DashboardUser);
            } catch {
                if (!cancelled) setAuthError("Network error — make sure the API server is running.");
            }
        }

        loadUser();
        return () => { cancelled = true; };
    }, [router]);


    const mobileNavRef = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        const el = mobileNavRef.current;
        if (!el) return;
        if (mobileOpen) {
            if (!el.open) el.showModal();
        } else {
            if (el.open) el.close();
        }
    }, [mobileOpen]);

    const [toasts, setToasts] = useState<Toast[]>([]);

    const addToast = useCallback((type: Toast["type"], message: string) => {
        const id = ++_toastId;
        setToasts((prev) => [...prev, { id, type, message }]);
        setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
    }, []);

    const dismissToast = useCallback((id: number) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape") setMobileOpen(false);
        }
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, []);

    useEffect(() => {
        if (mobileOpen) {
            document.body.style.overflow = "hidden";
        } else {
            document.body.style.overflow = "";
        }
        return () => { document.body.style.overflow = ""; };
    }, [mobileOpen]);

    if (authError) return (
        <div className="flex h-screen items-center justify-center bg-[var(--background)]">
            <div className="flex flex-col items-center gap-3 text-center px-6">
                <p className="text-sm text-[var(--text-secondary)]">{authError}</p>
                <button
                    onClick={() => { setAuthError(null); window.location.reload(); }}
                    className="text-xs font-medium px-4 py-2 rounded-lg bg-[var(--red)] text-white hover:bg-[var(--red-dim)] transition-colors"
                >
                    Retry
                </button>
            </div>
        </div>
    );

    if (!user) return (
        <div className="flex h-screen items-center justify-center bg-[var(--background)]">
            <div className="flex items-center gap-2 text-[var(--text-muted)] text-sm">
                <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                Loading…
            </div>
        </div>
    );


    return (
        <UserContext.Provider value={user}>
            <CampaignEventsProvider enabled={!!user}>
                <GlobalToastNotificationListener addToast={addToast} />
                <div className="flex h-screen overflow-hidden bg-[var(--background)]">
                    <a
                        href="#main-content"
                        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[9999] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-[var(--red)] focus:text-white focus:text-sm focus:font-semibold focus:shadow-lg focus:outline-none"
                    >
                        Skip to main content
                    </a>

                    <button
                        onClick={() => setMobileOpen(true)}
                        aria-label="Open navigation"
                        className="lg:hidden fixed top-4 left-4 z-40 flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <line x1="3" y1="6" x2="21" y2="6" />
                            <line x1="3" y1="12" x2="21" y2="12" />
                            <line x1="3" y1="18" x2="21" y2="18" />
                        </svg>
                    </button>

                    <dialog
                        ref={mobileNavRef}
                        onCancel={(e) => { e.preventDefault(); setMobileOpen(false); }}
                        aria-label="Navigation"
                        className="sheet-panel lg:hidden"
                    >
                        <div
                            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                            onClick={() => setMobileOpen(false)}
                            aria-hidden="true"
                        />
                        <div className="relative flex-shrink-0 z-10">
                            <Sidebar
                                collapsed={false}
                                onToggle={() => setMobileOpen(false)}
                                mobileClose={() => setMobileOpen(false)}
                            />
                        </div>
                    </dialog>

                    <div className="relative flex-shrink-0 hidden lg:block">
                        <Sidebar
                            collapsed={collapsed}
                            onToggle={() => setCollapsed((c) => !c)}
                        />
                    </div>

                    <main
                        id="main-content"
                        className="flex-1 flex flex-col overflow-hidden min-w-0"
                        tabIndex={-1}
                    >
                        {children}
                    </main>

                    <ToastRegion toasts={toasts} onDismiss={dismissToast} />
                </div>
            </CampaignEventsProvider>
        </UserContext.Provider>
    );
}