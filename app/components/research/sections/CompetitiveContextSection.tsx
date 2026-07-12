"use client";

import { CompetitiveContext } from "@/app/api/research/research.api";

interface CompetitiveContextSectionProps {
  context: CompetitiveContext;
}

export function CompetitiveContextSection({ context }: CompetitiveContextSectionProps) {
  return (
    <div className="space-y-4">
      {/* Competitor detected banner */}
      <div className={`p-3.5 rounded-lg border flex items-start gap-3 ${
        context.competitorSignalDetected
          ? "bg-amber-400/5 border-amber-400/20 text-amber-400"
          : "bg-slate-500/5 border-slate-500/20 text-[var(--text-secondary)]"
      }`}>
        <div className="pt-0.5">
          {context.competitorSignalDetected ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          )}
        </div>
        <div>
          <h5 className="text-xs font-bold uppercase tracking-wider">
            {context.competitorSignalDetected ? "Competitor Tech Detected" : "No competing tech flagged"}
          </h5>
          <p className="text-xs leading-relaxed mt-1 text-[var(--text-secondary)]">
            {context.competitorSignalDetected
              ? `Competing products are currently active: ${context.competitorProducts.join(", ")}. This creates a direct displacement opportunity.`
              : "No competing software detected. Focus on standard value propositions and greenfield placement."}
          </p>
        </div>
      </div>

      {/* Displacement & Complementary angles */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {context.displacementAngle && (
          <div className="bg-[var(--surface-2)] p-3 rounded-lg border border-[var(--border)]">
            <p className="text-[9px] font-bold text-amber-400 uppercase tracking-wider mb-1">Displacement Angle</p>
            <p className="text-xs text-[var(--text-primary)] leading-relaxed">{context.displacementAngle}</p>
          </div>
        )}
        {context.complementaryAngle && (
          <div className="bg-[var(--surface-2)] p-3 rounded-lg border border-[var(--border)]">
            <p className="text-[9px] font-bold text-sky-400 uppercase tracking-wider mb-1">Complementary Angle</p>
            <p className="text-xs text-[var(--text-primary)] leading-relaxed">{context.complementaryAngle}</p>
          </div>
        )}
      </div>

      {/* Similar wins and Historical win rates */}
      {context.similarWins && context.similarWins.length > 0 && (
        <div className="pt-2 border-t border-[var(--border)] mt-2">
          <div className="flex justify-between items-center mb-2">
            <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-widest">
              Historical Win Patterns
            </p>
            {context.winRateForSignalType != null && (
              <span className="text-[10px] font-bold text-emerald-400">
                Win Rate: {(context.winRateForSignalType * 100).toFixed(0)}%
              </span>
            )}
          </div>
          <div className="space-y-1.5">
            {context.similarWins.map((w, i) => (
              <div key={i} className="flex justify-between items-center p-2 rounded bg-[var(--surface-2)] border border-[var(--border)] text-xs">
                <span className="text-[var(--text-secondary)] truncate max-w-[50%]" title={w.signalValue}>
                  {w.signalType}: "{w.signalValue}"
                </span>
                <div className="flex gap-2">
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-sky-400/10 text-sky-400 uppercase font-bold tracking-wider">
                    {w.replyIntent}
                  </span>
                  {w.pipelineStageAtCapture && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--surface)] text-[var(--text-muted)] uppercase font-semibold">
                      {w.pipelineStageAtCapture}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
