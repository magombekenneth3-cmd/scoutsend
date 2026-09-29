"use client";

import { motion, AnimatePresence } from "framer-motion";
import type { Toast } from "../../hooks/useToast";

interface ToastRegionProps {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}

export function ToastRegion({ toasts, onDismiss }: ToastRegionProps) {
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none"
    >
      <AnimatePresence mode="popLayout">
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, y: 10 }}
            transition={{ type: "spring", stiffness: 450, damping: 30 }}
            role="status"
            className={[
              "pointer-events-auto flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-2xl text-sm font-medium",
              "border backdrop-blur-xl max-w-sm",
              t.type === "success"
                ? "bg-emerald-950/90 border-emerald-500/40 text-emerald-300 shadow-emerald-950/50"
                : t.type === "info"
                  ? "bg-sky-950/90 border-sky-500/40 text-sky-300 shadow-sky-950/50"
                  : "bg-[var(--navy-mid)]/90 border-[var(--border-red)] text-[var(--red-text)] shadow-rose-950/50",
            ].join(" ")}
          >
            {t.type === "success" ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : t.type === "info" ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="11" /><line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            )}
            <span className="flex-1">{t.message}</span>
            <button
              onClick={() => onDismiss(t.id)}
              aria-label="Dismiss"
              className="opacity-60 hover:opacity-100 transition-opacity focus-visible:outline-none cursor-pointer"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}