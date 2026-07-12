import {
  ResearchReport,
  ResearchStreamEvent,
  CompanySnapshot,
  CompetitiveContext,
  ICPAlignment,
  OutreachAngle,
} from "@/app/api/src/lib/research/research.types";

export type {
  ResearchReport,
  ResearchStreamEvent,
  CompanySnapshot,
  CompetitiveContext,
  ICPAlignment,
  OutreachAngle,
};

export async function fetchResearchReport(leadId: string): Promise<ResearchReport | null> {
  const res = await fetch(`/api/leads/${leadId}/research`);
  if (!res.ok) return null;
  const d = await res.json();
  return d.report ?? null;
}

export async function triggerResearch(leadId: string): Promise<{ reportId: string }> {
  const res = await fetch(`/api/leads/${leadId}/research`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to trigger research");
  return res.json();
}

export function openResearchStream(
  leadId: string,
  onEvent: (event: ResearchStreamEvent) => void,
): () => void {
  const es = new EventSource(`/api/leads/${leadId}/research/stream`);

  es.onmessage = (e) => {
    try {
      const event: ResearchStreamEvent = JSON.parse(e.data);
      onEvent(event);
    } catch {
      // malformed event — ignore
    }
  };

  es.onerror = () => {
    onEvent({ type: "error", data: { message: "Stream connection lost" } });
    es.close();
  };

  return () => es.close();
}
