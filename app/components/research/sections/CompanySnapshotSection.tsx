"use client";

import { CompanySnapshot } from "@/app/api/research/research.api";

interface CompanySnapshotSectionProps {
  snapshot: CompanySnapshot;
}

export function CompanySnapshotSection({ snapshot }: CompanySnapshotSectionProps) {
  return (
    <div className="space-y-4">
      {/* Value prop & Target customer */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-[var(--surface-2)] p-3 rounded-lg border border-[var(--border)]">
          <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">Value Proposition</p>
          <p className="text-xs text-[var(--text-primary)] leading-relaxed">{snapshot.valueProposition}</p>
        </div>
        <div className="bg-[var(--surface-2)] p-3 rounded-lg border border-[var(--border)]">
          <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">Target Customer</p>
          <p className="text-xs text-[var(--text-primary)] leading-relaxed">{snapshot.targetCustomer}</p>
        </div>
      </div>

      {/* Meta grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs bg-[var(--surface-2)] p-3 rounded-lg border border-[var(--border)]">
        <div>
          <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider block">Industry</span>
          <span className="text-[var(--text-primary)] font-semibold mt-0.5 block truncate">{snapshot.industry ?? "Unknown"}</span>
        </div>
        <div>
          <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider block">Employees</span>
          <span className="text-[var(--text-primary)] font-semibold mt-0.5 block">{snapshot.employeeCount ?? "Unknown"}</span>
        </div>
        <div>
          <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider block">Revenue Band</span>
          <span className="text-[var(--text-primary)] font-semibold mt-0.5 block">{snapshot.revenueBand ?? "Unknown"}</span>
        </div>
        <div>
          <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider block">Business Model</span>
          <span className="text-[var(--text-primary)] font-semibold mt-0.5 block">{snapshot.businessModel ?? "Unknown"}</span>
        </div>
      </div>

      {/* News & Signals */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* News */}
        {snapshot.recentNews && snapshot.recentNews.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-widest mb-2">Recent News</p>
            <div className="space-y-2">
              {snapshot.recentNews.map((n, i) => (
                <div key={i} className="p-2.5 rounded bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--red-glow)] transition-colors">
                  <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-sky-400 hover:underline block leading-snug">
                    {n.headline}
                  </a>
                  <p className="text-[10px] text-[var(--text-secondary)] mt-1">{n.relevanceReason}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Hiring & Funding */}
        <div className="space-y-4">
          {snapshot.hiringSignals && snapshot.hiringSignals.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-widest mb-2">Hiring Velocity</p>
              <div className="space-y-2">
                {snapshot.hiringSignals.map((h, i) => (
                  <div key={i} className="p-2.5 rounded bg-[var(--surface-2)] border border-[var(--border)] text-xs">
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-bold text-[var(--text-primary)]">{h.role}</span>
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-400/10 text-violet-400">
                        {(h.confidence * 100).toFixed(0)}% Conf
                      </span>
                    </div>
                    <p className="text-[10px] text-[var(--text-secondary)]">{h.explanation}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {snapshot.fundingEvents && snapshot.fundingEvents.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-widest mb-2">Funding Events</p>
              <div className="space-y-2">
                {snapshot.fundingEvents.map((f, i) => (
                  <div key={i} className="p-2.5 rounded bg-[var(--surface-2)] border border-[var(--border)] text-xs">
                    <span className="font-semibold text-[var(--text-primary)] block">{f.description}</span>
                    {f.amount && (
                      <span className="text-[10px] font-bold text-emerald-400 mt-1 block">Amount: {f.amount}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tech Stack */}
      {snapshot.techStack && snapshot.techStack.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-widest mb-2">Tech Stack</p>
          <div className="flex flex-wrap gap-1">
            {snapshot.techStack.map((t) => (
              <span key={t} className="text-[10px] px-2 py-0.5 rounded bg-[var(--surface-2)] text-[var(--text-secondary)] border border-[var(--border)]">
                {t}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
