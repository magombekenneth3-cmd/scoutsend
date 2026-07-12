import { emitCampaignEvent } from "../../../lib/campaign-events";

export function reportProgress(params: {
    campaignId: string;
    processed: number;
    total: number;
    lastEmittedPct: number;
}): number {
    const { campaignId, processed, total, lastEmittedPct } = params;
    const pct = Math.round((processed / total) * 100);

    if (pct > lastEmittedPct) {
        emitCampaignEvent({
            campaignId,
            type: "progress",
            jobName: "run-multi-source-discovery",
            label: "Discovery Agent",
            progress: pct,
            detail: `Processing leads ${processed}/${total}`,
        });
        return pct;
    }

    return lastEmittedPct;
}

export function reportCompleted(campaignId: string, created: number): void {
    emitCampaignEvent({
        campaignId,
        type: "completed",
        jobName: "run-multi-source-discovery",
        label: "Discovery Agent",
        detail: `${created} leads created`,
    });
}