"use client";

import React from "react";

interface ResearchSectionShellProps {
  label: string;
  complete: boolean;
  loading: boolean;
  streaming?: boolean;
  failedMessage?: string;
  children?: React.ReactNode;
}

export function ResearchSectionShell({ label, complete, loading, streaming, failedMessage, children }: ResearchSectionShellProps) {
  return (
    <div className="rounded-xl border border-[var(--border)] overflow-hidden bg-[var(--surface)]">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-[var(--surface-2)] border-b border-[var(--border)]">
        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
          failedMessage ? "bg-orange-400"
          : complete ? "bg-emerald-400"
          : streaming ? "bg-[var(--red)] animate-pulse"
          : loading ? "bg-[var(--border)] animate-pulse"
          : "bg-[var(--border)]"
        }`} />
        <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-widest">{label}</span>
        {streaming && (
          <span className="ml-auto text-[9px] text-[var(--red)] font-medium tracking-wide">GENERATING</span>
        )}
        {failedMessage && (
          <span className="ml-auto text-[9px] text-orange-400 font-medium tracking-wide">FAILED</span>
        )}
        {complete && !failedMessage && (
          <svg className="ml-auto w-3 h-3 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </div>
      <div className="px-4 py-4">
        {failedMessage ? (
          <div className="flex items-center gap-2 text-xs text-orange-400">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="flex-shrink-0">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>Failed to generate — retry by re-running the research agent.</span>
          </div>
        ) : loading && !streaming ? (
          <div className="space-y-2 animate-pulse">
            <div className="h-3 bg-[var(--surface-2)] rounded w-3/4" />
            <div className="h-3 bg-[var(--surface-2)] rounded w-1/2" />
            <div className="h-3 bg-[var(--surface-2)] rounded w-5/6" />
          </div>
        ) : children}
      </div>
    </div>
  );
}
