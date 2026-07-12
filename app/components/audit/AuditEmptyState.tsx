"use client";

interface AuditEmptyStateProps {
  filtered: boolean;
}

export function AuditEmptyState({ filtered }: AuditEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
      <div className="w-14 h-14 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          className="text-[var(--text-muted)]"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      </div>
      <p className="text-sm font-semibold text-[var(--text-primary)]">
        {filtered ? "No logs match these filters" : "No audit logs yet"}
      </p>
      <p className="text-xs text-[var(--text-muted)] max-w-[220px]">
        {filtered
          ? "Try adjusting your search, action, or date range."
          : "Audit events will appear here as users take actions."}
      </p>
    </div>
  );
}