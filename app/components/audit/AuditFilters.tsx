"use client";

import { AUDIT_ACTION_KEYS } from "./AuditActionBadge";

// Unique entity types extracted from known actions
const ENTITY_TYPES = [
  "lead",
  "campaign",
  "message",
  "reply",
  "user",
  "domain",
  "mailbox",
  "suppression",
  "learning",
  "brand",
  "queue",
  "unknown",
];

interface AuditFiltersProps {
  search: string;
  action: string;
  entityType: string;
  startDate: string;
  endDate: string;
  onSearch: (v: string) => void;
  onAction: (v: string) => void;
  onEntityType: (v: string) => void;
  onStartDate: (v: string) => void;
  onEndDate: (v: string) => void;
  onReset: () => void;
}

const selectBase =
  "h-8 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-xs px-2.5 pr-7 appearance-none focus:outline-none focus:border-[var(--border-red)] transition-colors cursor-pointer text-[var(--text-secondary)]";

const arrowStyle = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%238892b0' stroke-width='2.5' stroke-linecap='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
  backgroundRepeat: "no-repeat" as const,
  backgroundPosition: "right 7px center" as const,
};

const inputBase =
  "h-8 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-xs px-2.5 focus:outline-none focus:border-[var(--border-red)] transition-colors text-[var(--text-primary)] placeholder:text-[var(--text-muted)]";

export function AuditFilters({
  search,
  action,
  entityType,
  startDate,
  endDate,
  onSearch,
  onAction,
  onEntityType,
  onStartDate,
  onEndDate,
  onReset,
}: AuditFiltersProps) {
  const isDirty = search || action || entityType || startDate || endDate;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Search */}
      <div className="relative">
        <svg
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search user, action, entity…"
          className={`${inputBase} pl-8 w-52`}
        />
      </div>

      {/* Action filter */}
      <select
        value={action}
        onChange={(e) => onAction(e.target.value)}
        className={selectBase}
        style={arrowStyle}
      >
        <option value="">All actions</option>
        {AUDIT_ACTION_KEYS.map((a) => (
          <option key={a} value={a}>
            {a.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
          </option>
        ))}
      </select>

      {/* Entity type filter */}
      <select
        value={entityType}
        onChange={(e) => onEntityType(e.target.value)}
        className={selectBase}
        style={arrowStyle}
      >
        <option value="">All entities</option>
        {ENTITY_TYPES.map((et) => (
          <option key={et} value={et}>
            {et.charAt(0).toUpperCase() + et.slice(1)}
          </option>
        ))}
      </select>

      {/* Date range */}
      <input
        type="date"
        value={startDate}
        onChange={(e) => onStartDate(e.target.value)}
        title="From date"
        className={`${inputBase} w-32`}
        style={{ colorScheme: "dark" }}
      />
      <span className="text-xs text-[var(--text-muted)]">→</span>
      <input
        type="date"
        value={endDate}
        onChange={(e) => onEndDate(e.target.value)}
        title="To date"
        className={`${inputBase} w-32`}
        style={{ colorScheme: "dark" }}
      />

      {/* Reset */}
      {isDirty && (
        <button
          onClick={onReset}
          className="h-8 px-3 rounded-lg text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] border border-transparent hover:border-[var(--border)] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
        >
          Clear
        </button>
      )}
    </div>
  );
}