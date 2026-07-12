"use client";

interface ResearchTriggerPromptProps {
  companyName: string;
  isStale: boolean;
  onRun: () => void;
  triggering?: boolean;
}

export function ResearchTriggerPrompt({ companyName, isStale, onRun, triggering }: ResearchTriggerPromptProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center gap-4 bg-[var(--surface)] rounded-xl border border-dashed border-[var(--border)]">
      <div className="w-12 h-12 rounded-full bg-[var(--red-glow)] border border-[var(--border-red)] flex items-center justify-center text-[var(--red)]">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      </div>
      <div className="max-w-md px-4">
        <h4 className="text-sm font-bold text-[var(--text-primary)]">
          {isStale ? "Research Cache Expired" : "Deep Lead Research Agent"}
        </h4>
        <p className="text-xs text-[var(--text-secondary)] mt-1.5 leading-relaxed">
          {isStale
            ? `The existing research snapshot for ${companyName} is older than 24 hours. Refresh to run the multi-stage research agent and stream updated signals.`
            : `Run our deep research pipeline against ${companyName} to fetch recent news, analyze job postings, check competitive displacement opportunities, and synthesize target cold outreach tracks in real time.`}
        </p>
      </div>
      <button
        id="trigger-deep-research"
        onClick={onRun}
        disabled={triggering}
        aria-busy={triggering}
        className="inline-flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-lg bg-[var(--red)] text-white hover:bg-[var(--red-dim)] active:scale-[0.98] transition-all focus-visible:outline-none cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
      >
        {triggering ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        )}
        {triggering ? "Starting\u2026" : isStale ? "Refresh Intelligence" : "Trigger Deep Research"}
      </button>
    </div>
  );
}
