"use client";

export function AuditSkeletonRow() {
  return (
    <tr className="border-b border-[var(--border)]">
      {[80, 90, 160, 120, 80, 32].map((w, i) => (
        <td key={i} className="px-4 py-3.5">
          <div
            className="h-3 rounded bg-[var(--surface-2)] animate-pulse"
            style={{ width: w }}
          />
        </td>
      ))}
    </tr>
  );
}

export function AuditSkeletonCard() {
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-[var(--surface-2)] animate-pulse flex-shrink-0" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3 w-24 rounded bg-[var(--surface-2)] animate-pulse" />
          <div className="h-2.5 w-36 rounded bg-[var(--surface-2)] animate-pulse" />
        </div>
        <div className="h-5 w-20 rounded-full bg-[var(--surface-2)] animate-pulse" />
      </div>
      <div className="flex items-center justify-between pt-2 border-t border-[var(--border)]">
        <div className="h-2.5 w-20 rounded bg-[var(--surface-2)] animate-pulse" />
        <div className="h-2.5 w-24 rounded bg-[var(--surface-2)] animate-pulse" />
      </div>
    </div>
  );
}