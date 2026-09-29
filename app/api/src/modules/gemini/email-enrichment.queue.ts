import { createHash } from "crypto";
import { Queue } from "bullmq";
import { prisma } from "../../lib/prisma";
import { redisConnectionOptions } from "../../lib/ioredis";
import { logger } from "../../lib/logger";
import { QUEUE_POLICY } from "./queue-policy";
import { registerForShutdown } from "./worker-runtime";

const DEFAULT_QUALIFICATION_THRESHOLD = 0.4;
const BATCH_CHUNK_SIZE = 20;
const BULK_ADD_CHUNK_SIZE = 500;
const QUALIFICATION_QUERY_CHUNK_SIZE = 500;

export interface EmailEnrichmentJobData {
    type: "single";
    leadId: string;
    userId?: string;
}

export interface EmailEnrichmentBatchJobData {
    type: "batch";
    leadIds: string[];
    campaignId: string;
}

type EnrichmentBulkJobSpec = {
    name: string;
    data: EmailEnrichmentBatchJobData;
    opts: {
        jobId: string;
    };
};

export interface EmailRevealGateResult {
    qualifiedIds: string[];
    skipped: number;
}

export const emailEnrichmentQueue = new Queue<
    EmailEnrichmentJobData | EmailEnrichmentBatchJobData
>(
    QUEUE_POLICY.emailEnrichment.queueName,
    {
        connection: redisConnectionOptions,
        defaultJobOptions: QUEUE_POLICY.emailEnrichment.defaultJobOptions,
    },
);

registerForShutdown(emailEnrichmentQueue);

export async function enqueueEnrichmentBatches(
    leadIds: string[],
    campaignId: string,
): Promise<number> {
    if (!campaignId || campaignId.trim().length === 0) {
        throw new Error("enqueueEnrichmentBatches requires a non-empty campaignId");
    }

    const uniqueLeadIds = [...new Set(leadIds.filter((id) => id.trim().length > 0))];

    if (uniqueLeadIds.length === 0) {
        return 0;
    }

    const chunks: string[][] = [];

    for (let i = 0; i < uniqueLeadIds.length; i += BATCH_CHUNK_SIZE) {
        chunks.push(uniqueLeadIds.slice(i, i + BATCH_CHUNK_SIZE));
    }

    const jobs: EnrichmentBulkJobSpec[] = chunks.map((chunk) => {
        const sortedIds = [...chunk].sort();

        const hash = createHash("sha256")
            .update(`${campaignId}:${sortedIds.join(",")}`)
            .digest("hex")
            .slice(0, 16);

        return {
            name: "enrich-lead-batch",
            data: {
                type: "batch",
                leadIds: chunk,
                campaignId,
            },
            opts: {
                jobId: `enrich-batch-${campaignId}-${hash}`,
            },
        };
    });

    const bulkChunks: EnrichmentBulkJobSpec[][] = [];

    for (let i = 0; i < jobs.length; i += BULK_ADD_CHUNK_SIZE) {
        bulkChunks.push(jobs.slice(i, i + BULK_ADD_CHUNK_SIZE));
    }

    const results = await Promise.allSettled(
        bulkChunks.map((bulkChunk) => emailEnrichmentQueue.addBulk(bulkChunk)),
    );

    let succeeded = 0;

    results.forEach((result, index) => {
        if (result.status === "fulfilled") {
            succeeded += result.value.length;
            return;
        }

        logger.error(
            {
                campaignId,
                chunk: index + 1,
                totalChunks: bulkChunks.length,
                error: result.reason,
            },
            "[email-enrichment.queue] Failed to enqueue enrichment bulk chunk",
        );
    });

    if (succeeded === 0) {
        throw new Error(
            `All ${chunks.length} enrichment chunks failed to enqueue for campaign ${campaignId}`,
        );
    }

    return succeeded;
}

export async function enqueueEmailRevealForQualifiedLeads(
    leadIds: string[],
    campaignId: string,
    qualificationThreshold?: number,
): Promise<EmailRevealGateResult> {
    if (!campaignId || campaignId.trim().length === 0) {
        throw new Error(
            "enqueueEmailRevealForQualifiedLeads requires a non-empty campaignId",
        );
    }

    const uniqueLeadIds = [
        ...new Set(leadIds.filter((id) => id.trim().length > 0)),
    ];

    if (uniqueLeadIds.length === 0) {
        return {
            qualifiedIds: [],
            skipped: 0,
        };
    }

    let threshold =
        qualificationThreshold ?? DEFAULT_QUALIFICATION_THRESHOLD;

    if (
        !Number.isFinite(threshold) ||
        threshold < 0 ||
        threshold > 1
    ) {
        throw new Error(
            "qualificationThreshold must be a number between 0 and 1",
        );
    }

    if (qualificationThreshold === undefined) {
        const campaign = await prisma.campaign.findUnique({
            where: {
                id: campaignId,
            },
            select: {
                qualificationThreshold: true,
            },
        });

        if (
            typeof campaign?.qualificationThreshold === "number" &&
            Number.isFinite(campaign.qualificationThreshold) &&
            campaign.qualificationThreshold >= 0 &&
            campaign.qualificationThreshold <= 1
        ) {
            threshold = campaign.qualificationThreshold;
        }
    }

    const qualifiedIds: string[] = [];

    for (
        let i = 0;
        i < uniqueLeadIds.length;
        i += QUALIFICATION_QUERY_CHUNK_SIZE
    ) {
        const candidateIds = uniqueLeadIds.slice(
            i,
            i + QUALIFICATION_QUERY_CHUNK_SIZE,
        );

        const leads = await prisma.lead.findMany({
            where: {
                id: {
                    in: candidateIds,
                },
                deletedAt: null,
            },
            select: {
                id: true,
                qualificationScore: true,
                recommendedAction: true,
            },
        });

        for (const lead of leads) {
            if (
                lead.qualificationScore !== null &&
                lead.qualificationScore >= threshold &&
                lead.recommendedAction !== "DISQUALIFY"
            ) {
                qualifiedIds.push(lead.id);
            }
        }
    }

    if (qualifiedIds.length === 0) {
        logger.info(
            {
                campaignId,
                candidates: uniqueLeadIds.length,
                threshold,
            },
            "[email-enrichment.queue] No leads cleared the qualification bar",
        );

        return {
            qualifiedIds: [],
            skipped: uniqueLeadIds.length,
        };
    }

    const queued = await enqueueEnrichmentBatches(
        qualifiedIds,
        campaignId,
    );

    logger.info(
        {
            campaignId,
            candidates: uniqueLeadIds.length,
            qualified: qualifiedIds.length,
            queued,
            skipped: uniqueLeadIds.length - qualifiedIds.length,
            threshold,
        },
        "[email-enrichment.queue] Qualified email reveal jobs queued",
    );

    return {
        qualifiedIds,
        skipped: uniqueLeadIds.length - qualifiedIds.length,
    };
}