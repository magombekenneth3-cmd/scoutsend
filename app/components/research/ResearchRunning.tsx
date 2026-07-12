"use client";

import { CompanySnapshot, CompetitiveContext, ICPAlignment, OutreachAngle } from "@/app/api/research/research.api";
import { ResearchSectionShell } from "./ResearchSectionShell";
import { CompanySnapshotSection } from "./sections/CompanySnapshotSection";
import { CompetitiveContextSection } from "./sections/CompetitiveContextSection";
import { ICPAlignmentSection } from "./sections/ICPAlignmentSection";
import { OutreachAngleSection } from "./sections/OutreachAngleSection";

interface RunningState {
  status: string;
  companySnapshot: CompanySnapshot | null;
  competitiveContext: CompetitiveContext | null;
  icpAlignment: ICPAlignment | null;
  outreachAngle: OutreachAngle | null;
  outreachAngleChunks: string;
  newSignals: string[];
  sectionErrors: Record<string, string>;
}

interface ResearchRunningProps {
  companyName: string;
  state: RunningState;
  onCancel: () => void;
}

const STAGE_LABELS: Record<string, string> = {
  PENDING: "Starting research…",
  RUNNING: "Researching",
};

export function ResearchRunning({ companyName, state, onCancel }: ResearchRunningProps) {
  const sectionsComplete = [
    state.companySnapshot,
    state.competitiveContext,
    state.icpAlignment,
  ].filter(Boolean).length;

  const totalSections = 4;
  const isOutreachStreaming = !state.outreachAngle && state.outreachAngleChunks.length > 0;
  const completedCount = sectionsComplete + (state.outreachAngle ? 1 : 0);

  return (
    <div className="space-y-4">
      {/* Progress header */}
      <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-3">
          <div className="relative w-4 h-4">
            <svg className="animate-spin w-4 h-4 text-[var(--red)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          </div>
        <div>
            <p aria-live="polite" className="text-xs font-semibold text-[var(--text-primary)]">
              {STAGE_LABELS[state.status] ?? "Researching"} {companyName}
            </p>
            <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
              {completedCount} of {totalSections} sections complete
            </p>
          </div>
        </div>
        <button
          onClick={onCancel}
          className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors cursor-pointer"
        >
          Cancel
        </button>
      </div>

      {/* Progress bar */}
      <div
        role="progressbar"
        aria-valuenow={completedCount}
        aria-valuemin={0}
        aria-valuemax={totalSections}
        aria-label="Research progress"
        className="h-0.5 bg-[var(--surface-2)] rounded-full overflow-hidden"
      >
        <div
          className="h-full bg-[var(--red)] rounded-full transition-all duration-700 ease-out"
          style={{ width: `${(completedCount / totalSections) * 100}%` }}
        />
      </div>

      {/* Sections reveal as they complete */}
      <div className="space-y-4">
        <ResearchSectionShell
          label="Company Intelligence"
          complete={!!state.companySnapshot}
          loading={!state.companySnapshot}
        >
          {state.companySnapshot && <CompanySnapshotSection snapshot={state.companySnapshot} />}
        </ResearchSectionShell>

        {(state.companySnapshot || state.competitiveContext) && (
          <ResearchSectionShell
            label="Competitive Context"
            complete={!!state.competitiveContext}
            loading={!state.competitiveContext}
          >
            {state.competitiveContext && <CompetitiveContextSection context={state.competitiveContext} />}
          </ResearchSectionShell>
        )}

        {(state.competitiveContext || state.icpAlignment) && (
          <ResearchSectionShell
            label="ICP Alignment"
            complete={!!state.icpAlignment}
            loading={!state.icpAlignment}
          >
            {state.icpAlignment && <ICPAlignmentSection alignment={state.icpAlignment} />}
          </ResearchSectionShell>
        )}

        {(state.icpAlignment || state.outreachAngle || isOutreachStreaming || state.sectionErrors["outreachAngle"]) && (
          <ResearchSectionShell
            label="Outreach Angle"
            complete={!!state.outreachAngle}
            loading={!state.outreachAngle && !isOutreachStreaming && !state.sectionErrors["outreachAngle"]}
            streaming={isOutreachStreaming}
            failedMessage={state.sectionErrors["outreachAngle"]}
          >
            {state.outreachAngle
              ? <OutreachAngleSection angle={state.outreachAngle} />
              : isOutreachStreaming
                ? <StreamingTextPreview text={state.outreachAngleChunks} />
                : null}
          </ResearchSectionShell>
        )}
      </div>

      {/* New signals discovered */}
      {state.newSignals.length > 0 && (
        <div className="rounded-lg bg-sky-400/5 border border-sky-400/15 px-3 py-2.5">
          <p className="text-[10px] font-semibold text-sky-400 uppercase tracking-widest mb-1.5">
            {state.newSignals.length} new signal{state.newSignals.length > 1 ? "s" : ""} discovered
          </p>
          {state.newSignals.map((s, i) => (
            <p key={i} className="text-[11px] text-[var(--text-secondary)]">{s}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function StreamingTextPreview({ text }: { text: string }) {
  return (
    <div className="font-mono text-xs text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap opacity-80 bg-[var(--surface)] p-3 rounded-lg border border-[var(--border)]">
      {text}
      <span className="inline-block w-1.5 h-3 bg-[var(--red)] ml-0.5 animate-pulse align-middle" />
    </div>
  );
}
