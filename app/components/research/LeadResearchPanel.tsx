"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  ResearchReport,
  ResearchStreamEvent,
  CompanySnapshot,
  CompetitiveContext,
  ICPAlignment,
  OutreachAngle,
} from "@/app/api/research/research.api";
import {
  fetchResearchReport,
  triggerResearch,
  openResearchStream,
} from "@/app/api/research/research.api";
import { ResearchTriggerPrompt } from "./ResearchTriggerPrompt";
import { ResearchRunning } from "./ResearchRunning";
import { ResearchComplete } from "./ResearchComplete";

interface StreamState {
  status: ResearchReport["status"] | "IDLE";
  companySnapshot: CompanySnapshot | null;
  competitiveContext: CompetitiveContext | null;
  icpAlignment: ICPAlignment | null;
  outreachAngle: OutreachAngle | null;
  outreachAngleChunks: string;
  newSignals: string[];
  error: string | null;
  sectionErrors: Record<string, string>;
}

interface LeadResearchPanelProps {
  leadId: string;
  leadName: string;
  companyName: string;
}

const INITIAL_STREAM: StreamState = {
  status: "IDLE",
  companySnapshot: null,
  competitiveContext: null,
  icpAlignment: null,
  outreachAngle: null,
  outreachAngleChunks: "",
  newSignals: [],
  error: null,
  sectionErrors: {},
};

export function LeadResearchPanel({ leadId, leadName, companyName }: LeadResearchPanelProps) {
  const [streamState, setStreamState] = useState<StreamState>(INITIAL_STREAM);
  const [cachedReport, setCachedReport] = useState<ResearchReport | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const closeStreamRef = useRef<(() => void) | null>(null);

  // On mount — check if a fresh report already exists
  useEffect(() => {
    fetchResearchReport(leadId).then((report) => {
      if (report && report.status === "COMPLETE") {
        setCachedReport(report);
        setStreamState(prev => ({ ...prev, status: "COMPLETE" }));
      } else if (report && (report.status === "RUNNING" || report.status === "PENDING")) {
        // A run is already in progress — restore completed segments and connect to stream
        setStreamState(prev => ({
          ...prev,
          status: report.status,
          companySnapshot: report.companySnapshot,
          competitiveContext: report.competitiveContext,
          icpAlignment: report.icpAlignment,
          outreachAngle: report.outreachAngle,
          newSignals: report.newSignalsFound ?? [],
        }));
        startStream(true);
      } else if (report && report.status === "FAILED") {
        // Failed run — display error
        setStreamState(prev => ({
          ...prev,
          status: "FAILED",
          error: report.errorMessage || "Research failed",
        }));
      }
      setBootstrapping(false);
    }).catch(() => setBootstrapping(false));
  }, [leadId]);

  // Cleanup stream on unmount
  useEffect(() => {
    return () => { closeStreamRef.current?.(); };
  }, []);

  const handleEvent = useCallback((event: ResearchStreamEvent) => {
    setStreamState(prev => {
      switch (event.type) {
        case "status":
          return { ...prev, status: event.data.status };

        case "section": {
          const { section, payload } = event.data;
          if (section === "companySnapshot") return { ...prev, companySnapshot: payload as CompanySnapshot };
          if (section === "competitiveContext") return { ...prev, competitiveContext: payload as CompetitiveContext };
          if (section === "icpAlignment") return { ...prev, icpAlignment: payload as ICPAlignment };
          if (section === "outreachAngle") {
            // The outreach section streams in two modes:
            // 1. chunk { chunk: string } — text streaming in progress
            // 2. final OutreachAngle object — fully parsed, replace chunks
            const p = payload as any;
            if (p && typeof p.chunk === "string") {
              return { ...prev, outreachAngleChunks: prev.outreachAngleChunks + p.chunk };
            }
            return { ...prev, outreachAngle: payload as OutreachAngle, outreachAngleChunks: "" };
          }
          return prev;
        }

        case "signal":
          return { ...prev, newSignals: [...prev.newSignals, `${event.data.signalType}: ${event.data.value}`] };

        case "error":
          return { ...prev, status: "FAILED", error: event.data.message };

        case "complete":
          return { ...prev, status: "COMPLETE" };

        case "section_failed":
          return { ...prev, sectionErrors: { ...prev.sectionErrors, [event.data.section]: event.data.message } };

        default:
          return prev;
      }
    });
  }, []);

  function startStream(keepData?: boolean) {
    closeStreamRef.current?.();
    if (!keepData) {
      setStreamState({ ...INITIAL_STREAM, status: "PENDING" });
      setCachedReport(null);
    }
    const close = openResearchStream(leadId, handleEvent);
    closeStreamRef.current = close;
  }

  async function handleRun() {
    if (triggering) return;
    setTriggering(true);
    try {
      await triggerResearch(leadId);
      startStream();
    } catch {
      setStreamState(prev => ({ ...prev, error: "Failed to start research" }));
    } finally {
      setTriggering(false);
    }
  }

  if (bootstrapping) {
    return (
      <div className="py-12 flex items-center justify-center">
        <svg className="animate-spin w-5 h-5 text-[var(--text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      </div>
    );
  }

  if (streamState.status === "IDLE" || streamState.status === "STALE") {
    return (
      <ResearchTriggerPrompt
        companyName={companyName}
        isStale={streamState.status === "STALE"}
        onRun={handleRun}
        triggering={triggering}
      />
    );
  }

  if (streamState.status === "COMPLETE" && (cachedReport || streamState.companySnapshot)) {
    const finalReport = cachedReport || {
      id: "temporary",
      leadId,
      status: "COMPLETE" as const,
      companySnapshot: streamState.companySnapshot,
      competitiveContext: streamState.competitiveContext,
      icpAlignment: streamState.icpAlignment,
      outreachAngle: streamState.outreachAngle,
      newSignalsFound: streamState.newSignals,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      expiresAt: null,
    };
    return (
      <ResearchComplete
        report={finalReport}
        companyName={companyName}
        onRefresh={handleRun}
      />
    );
  }

  if (streamState.status === "FAILED") {
    return (
      <div className="py-8 text-center space-y-3">
        <p className="text-sm text-red-400">{streamState.error ?? "Research failed"}</p>
        <button onClick={handleRun} className="text-xs text-[var(--text-secondary)] underline hover:text-[var(--text-primary)] cursor-pointer">Try again</button>
      </div>
    );
  }

  // PENDING or RUNNING — show live stream state
  return (
    <ResearchRunning
      companyName={companyName}
      state={streamState}
      onCancel={() => { closeStreamRef.current?.(); setStreamState({ ...INITIAL_STREAM }); }}
    />
  );
}
