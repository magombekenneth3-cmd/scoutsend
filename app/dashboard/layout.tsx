"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Sidebar } from "../components/dashboard/SideBar";
import { ToastRegion } from "../components/dashboard/ToastRegion";
import type { Toast } from "../hooks/useToast";

let _toastId = 0;

interface CampaignSSEEvent {
    campaignId: string;
    type: "active" | "progress" | "completed" | "failed";
    jobName: string;
    label: string;
    detail?: string;
    timestamp: string;
}

const NOTIFY_ON_COMPLETE = new Set([
    "poll-mailbox-replies",
    "send-batch",
]);

const NOTIFY_LABELS: Record<string, string> = {
    "poll-mailbox-replies": "New reply received",
    "send-batch": "Email batch sent",
};

const SSE_MIN_RETRY_MS = 8_000;
const SSE_MAX_RETRY_MS = 30_000;

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const [collapsed, setCollapsed] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);
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
    const esRef = useRef<EventSource | null>(null);
    const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const retryDelayRef = useRef(SSE_MIN_RETRY_MS);
    const abortedRef = useRef(false);

    const addToast = useCallback((type: Toast["type"], message: string) => {
        const id = ++_toastId;
        setToasts((prev) => [...prev, { id, type, message }]);
        setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
    }, []);

    const dismissToast = useCallback((id: number) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    const connect = useCallback(() => {
        if (esRef.current || abortedRef.current) return;

        const es = new EventSource("/api/campaigns/events");
        esRef.current = es;

        es.onopen = () => {
            retryDelayRef.current = SSE_MIN_RETRY_MS;
        };

        es.onmessage = (e) => {
            try {
                const event: CampaignSSEEvent = JSON.parse(e.data);
                if (event.type === "failed") {
                    addToast("error", `${event.label} failed${event.detail ? `: ${event.detail}` : ""}`);
                } else if (event.type === "completed" && NOTIFY_ON_COMPLETE.has(event.jobName)) {
                    const label = NOTIFY_LABELS[event.jobName] ?? event.label;
                    addToast("success", label);
                }
            } catch {}
        };

        es.onerror = () => {
            es.close();
            esRef.current = null;

            if (abortedRef.current) return;

            retryDelayRef.current = Math.min(retryDelayRef.current * 2, SSE_MAX_RETRY_MS);
            retryRef.current = setTimeout(connect, retryDelayRef.current);
        };
    }, [addToast]);

    useEffect(() => {
        abortedRef.current = false;
        retryDelayRef.current = SSE_MIN_RETRY_MS;

        const timer = setTimeout(connect, 1_000);

        return () => {
            abortedRef.current = true;
            clearTimeout(timer);
            if (retryRef.current) clearTimeout(retryRef.current);
            esRef.current?.close();
            esRef.current = null;
        };
    }, [connect]);

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

    return (
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
    );
}