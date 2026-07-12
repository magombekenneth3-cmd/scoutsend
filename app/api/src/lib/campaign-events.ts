import { EventEmitter } from "events";

export interface CampaignEvent {
    campaignId: string;
    type: "active" | "progress" | "completed" | "failed";
    jobName: string;
    label: string;
    progress?: number;
    detail?: string;
    count?: number;
    timestamp: string;
}

class CampaignEventBus extends EventEmitter {
    emit(event: "campaign-event", data: CampaignEvent): boolean;
    emit(event: string, ...args: any[]): boolean {
        return super.emit(event, ...args);
    }

    on(event: "campaign-event", listener: (data: CampaignEvent) => void): this;
    on(event: string, listener: (...args: any[]) => void): this {
        return super.on(event, listener);
    }

    off(event: "campaign-event", listener: (data: CampaignEvent) => void): this;
    off(event: string, listener: (...args: any[]) => void): this {
        return super.off(event, listener);
    }
}

export const campaignEventBus = new CampaignEventBus();
campaignEventBus.setMaxListeners(50);

const JOB_LABELS: Record<string, string> = {
    "run-research": "Research Agent",
    "run-generate": "Message Generation",
    "run-review": "Review Agent",
    "run-multi-source-discovery": "Discovery Agent",
    "run-community-intent": "Community Intent",
    "run-job-intel": "Job Intel Agent",
    "run-tech-detection": "Tech Detection",
    "run-bulk-scoring": "Lead Scoring",
    "run-icp-refinement": "ICP Refinement",
    "run-pipeline": "Pipeline",
    "run-followup": "Follow-up Sequence",
    "send-batch": "Sending Emails",
    "enrich-and-score": "Enrichment & Scoring",
    "score-lead-batch": "Scoring Leads",
    "top-up-leads": "Top-up Leads",
    "populate-tech-signals": "Tech Signals",
    "scan-queued-campaigns": "Queue Scan",
    "scan-followup-leads": "Follow-up Scan",
    "poll-mailbox-replies": "Checking Replies",
    "poll-mailbox-delivery-events": "Delivery Events",
    "recover-stuck-sending": "Recovery",
    "nightly-multi-source-discovery": "Nightly Discovery",
    "nightly-enrichment-refresh": "Enrichment Refresh",
    "nightly-community-intent": "Community Scan",
    "daily-campaign-health-check": "Health Check",
    "daily-warmup-update": "Warmup Update",
    "handle-objections": "Objection Handler",
};

export function getJobLabel(jobName: string): string {
    return JOB_LABELS[jobName] ?? jobName.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function emitCampaignEvent(event: Omit<CampaignEvent, "timestamp">) {
    campaignEventBus.emit("campaign-event", {
        ...event,
        timestamp: new Date().toISOString(),
    });
}
