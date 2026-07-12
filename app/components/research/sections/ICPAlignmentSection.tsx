"use client";

import { ICPAlignment } from "@/app/api/research/research.api";

interface ICPAlignmentSectionProps {
  alignment: ICPAlignment;
}

export function ICPAlignmentSection({ alignment }: ICPAlignmentSectionProps) {
  const displayScore = alignment.overallFitScore;
  const scoreColor = displayScore >= 80 ? "text-emerald-400" : displayScore >= 55 ? "text-amber-400" : "text-[var(--red)]";
  const scoreBg = displayScore >= 80 ? "bg-emerald-400/10 border-emerald-400/20" : displayScore >= 55 ? "bg-amber-400/10 border-amber-400/20" : "bg-[var(--red-glow)] border-[var(--border-red)]";

  return (
    <div className="space-y-4">
      {/* Overall score and recommended action */}
      <div className={`p-4 rounded-xl border flex items-center justify-between gap-4 ${scoreBg}`}>
        <div className="flex items-center gap-4">
          <div className={`text-3xl font-extrabold tracking-tight tabular-nums ${scoreColor}`}>
            {displayScore}
          </div>
          <div>
            <h5 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">ICP Fit Score</h5>
            <p className="text-[10px] text-[var(--text-secondary)] mt-0.5">Based on campaign criteria, signals, and company scale</p>
          </div>
        </div>
        <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-md uppercase tracking-wider border ${
          alignment.recommendedAction === "HIGH_PRIORITY"
            ? "bg-emerald-400/10 text-emerald-400 border-emerald-400/20"
            : alignment.recommendedAction === "STANDARD"
              ? "bg-sky-400/10 text-sky-400 border-sky-400/20"
              : alignment.recommendedAction === "NURTURE"
                ? "bg-amber-400/10 text-amber-400 border-amber-400/20"
                : "bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]"
        }`}>
          {alignment.recommendedAction.replace(/_/g, " ")}
        </span>
      </div>

      {/* Narratives */}
      <div className="space-y-2.5">
        <div className="bg-[var(--surface-2)] p-3 rounded-lg border border-[var(--border)]">
          <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">Alignment Narrative</p>
          <p className="text-xs text-[var(--text-primary)] leading-relaxed">{alignment.fitNarrative}</p>
        </div>
        {alignment.gapNarrative && (
          <div className="bg-[var(--surface-2)] p-3 rounded-lg border border-[var(--border)]">
            <p className="text-[9px] font-bold text-amber-400 uppercase tracking-wider mb-1">Identified Gaps</p>
            <p className="text-xs text-[var(--text-primary)] leading-relaxed">{alignment.gapNarrative}</p>
          </div>
        )}
      </div>

      {/* Score breakdown metrics */}
      <div>
        <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-widest mb-2">Metrics Breakdown</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {Object.entries(alignment.breakdown).map(([key, val]) => (
            <div key={key} className="bg-[var(--surface-2)] p-2.5 rounded border border-[var(--border)] flex justify-between items-center text-xs">
              <span className="text-[var(--text-secondary)] font-medium capitalize">
                {key.replace(/([A-Z])/g, " $1")}
              </span>
              <span className="font-bold text-[var(--text-primary)] tabular-nums">
                {val}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Evidence triggers */}
      {alignment.evidenceTriggers && alignment.evidenceTriggers.length > 0 && (
        <div className="pt-2 border-t border-[var(--border)] mt-2">
          <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-widest mb-2">Key Evidence Triggers</p>
          <div className="space-y-1.5">
            {alignment.evidenceTriggers.map((t, idx) => (
              <div key={idx} className="flex items-start gap-2.5 text-xs text-[var(--text-secondary)]">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--red)] mt-1.5 flex-shrink-0" />
                <span className="leading-relaxed">{t}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Contact fit note */}
      {alignment.contactFitNote && (
        <div className="p-3 rounded bg-sky-400/5 border border-sky-400/10 text-xs">
          <span className="font-bold text-sky-400 block mb-1">Decision-Maker Fit Note</span>
          <p className="text-[var(--text-secondary)] leading-relaxed">{alignment.contactFitNote}</p>
        </div>
      )}
    </div>
  );
}
