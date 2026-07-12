"use client";

import { ResearchReport } from "@/app/api/research/research.api";
import { ResearchSectionShell } from "./ResearchSectionShell";
import { CompanySnapshotSection } from "./sections/CompanySnapshotSection";
import { CompetitiveContextSection } from "./sections/CompetitiveContextSection";
import { ICPAlignmentSection } from "./sections/ICPAlignmentSection";
import { OutreachAngleSection } from "./sections/OutreachAngleSection";

interface ResearchCompleteProps {
  report: ResearchReport;
  companyName: string;
  onRefresh: () => void;
}

export function ResearchComplete({ report, companyName, onRefresh }: ResearchCompleteProps) {
  const formattedDate = report.completedAt
    ? new Date(report.completedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Recently";

  return (
    <div className="space-y-6">
      {/* Complete Header */}
      <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
        <div>
          <h4 className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-emerald-400">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            Research Report — {companyName}
          </h4>
          <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
            Last updated: {formattedDate}
          </p>
        </div>
        <button
          onClick={onRefresh}
          className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
          </svg>
          Re-run Research
        </button>
      </div>

      {/* Grid of Sections */}
      <div className="space-y-4">
        {report.companySnapshot && (
          <ResearchSectionShell
            label="Company Intelligence"
            complete={true}
            loading={false}
          >
            <CompanySnapshotSection snapshot={report.companySnapshot} />
          </ResearchSectionShell>
        )}

        {report.competitiveContext && (
          <ResearchSectionShell
            label="Competitive Context"
            complete={true}
            loading={false}
          >
            <CompetitiveContextSection context={report.competitiveContext} />
          </ResearchSectionShell>
        )}

        {report.icpAlignment && (
          <ResearchSectionShell
            label="ICP Alignment"
            complete={true}
            loading={false}
          >
            <ICPAlignmentSection alignment={report.icpAlignment} />
          </ResearchSectionShell>
        )}

        {report.outreachAngle && (
          <ResearchSectionShell
            label="Outreach Angle"
            complete={true}
            loading={false}
          >
            <OutreachAngleSection angle={report.outreachAngle} />
          </ResearchSectionShell>
        )}
      </div>
    </div>
  );
}
