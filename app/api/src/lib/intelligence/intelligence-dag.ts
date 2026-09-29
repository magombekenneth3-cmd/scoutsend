import { buildOperationId } from "../events/event-identity";
import { logger } from "../logger";

export type IntelligenceTask =
    | "company-enrichment"
    | "person-enrichment"
    | "tech-detection"
    | "job-intel"
    | "community-intent"
    | "website-scrape";

export const ALL_INTELLIGENCE_TASKS: IntelligenceTask[] = [
    "company-enrichment",
    "person-enrichment",
    "tech-detection",
    "job-intel",
    "community-intent",
    "website-scrape",
];

// ---------------------------------------------------------------------------
// Evidence barrier policy
//
// required    — ALL must SUCCEED; any FAILED is terminal for the barrier
// optional    — at least minimumOptionalSucceeded must SUCCEED within maximumWaitMs
// ---------------------------------------------------------------------------

export const INTELLIGENCE_TASK_POLICY = {
    required: ["company-enrichment", "person-enrichment"] as const,
    optional: ["tech-detection", "job-intel", "community-intent", "website-scrape"] as const,
    minimumOptionalSucceeded: 2,
    maximumWaitMs: 15 * 60_000, // 15 min before proceeding with partial evidence
} as const;

export interface IntelligenceJobData {
    leadId: string;
    campaignId: string;
    operationId: string;
    task: IntelligenceTask;
    runId: string;
}

export function buildIntelligenceDAGJobs(
    leadId: string,
    campaignId: string,
    runId: string,
): Array<{ name: string; data: IntelligenceJobData; opts: { jobId: string } }> {
    return ALL_INTELLIGENCE_TASKS.map((task) => {
        const operationId = buildOperationId("intel", leadId, task, runId);
        return {
            name: task,
            data: { leadId, campaignId, operationId, task, runId },
            opts: { jobId: operationId },
        };
    });
}

/**
 * Legacy all-or-nothing check — kept for backward compatibility.
 * Prefer evaluateEvidenceBarrier from evidence-barrier.ts for new code.
 */
export async function areAllIntelligenceTasksComplete(
    leadId: string,
    runId: string,
    prisma: { operation: { count: (args: any) => Promise<number> } },
): Promise<boolean> {
    const successCount = await prisma.operation.count({
        where: {
            aggregateId: leadId,
            operationType: {
                in: ALL_INTELLIGENCE_TASKS.map((t) =>
                    buildOperationId("intel", leadId, t, runId),
                ),
            },
            status: "SUCCEEDED",
        },
    });

    const complete = successCount >= ALL_INTELLIGENCE_TASKS.length;

    if (!complete) {
        logger.debug(
            { leadId, runId, successCount, total: ALL_INTELLIGENCE_TASKS.length },
            "[intelligence-dag] Aggregation barrier not yet cleared",
        );
    }

    return complete;
}
