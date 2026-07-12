import { createHash } from "crypto";
import { Queue } from "bullmq";
import { redisConnectionOptions } from "../../lib/ioredis";
import { logger } from "../../lib/logger";

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
    opts: { jobId: string };
};

export const emailEnrichmentQueue = new Queue<EmailEnrichmentJobData | EmailEnrichmentBatchJobData>("email-enrichment", {
    connection: redisConnectionOptions,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { age: 60 * 60 * 24 },
        removeOnFail: { age: 60 * 60 * 24 * 7 },
    },
});

const BATCH_CHUNK_SIZE = 20;
const BULK_ADD_CHUNK_SIZE = 500;

export async function enqueueEnrichmentBatches(
    leadIds: string[],
    campaignId: string,
): Promise<number> {
    if (!campaignId || campaignId.trim().length === 0) {
        throw new Error("enqueueEnrichmentBatches requires a non-empty campaignId");
    }

    if (leadIds.length === 0) return 0;

    const chunks: string[][] = [];
    for (let i = 0; i < leadIds.length; i += BATCH_CHUNK_SIZE) {
        chunks.push(leadIds.slice(i, i + BATCH_CHUNK_SIZE));
    }

    const jobs: EnrichmentBulkJobSpec[] = chunks.map((chunk): EnrichmentBulkJobSpec => {
        const sortedIds = [...chunk].sort();
        const hash = createHash("sha256")
            .update(`${campaignId}:${sortedIds.join(",")}`)
            .digest("hex")
            .slice(0, 16);

        return {
            name: "enrich-lead-batch",
            data: { type: "batch", leadIds: chunk, campaignId },
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
        } else {
            logger.error(
                `Failed to enqueue enrichment bulk chunk ${index + 1}/${bulkChunks.length} for campaign ${campaignId}:`,
                result.reason,
            );
        }
    });

    if (succeeded === 0) {
        throw new Error(`All ${chunks.length} enrichment chunks failed to enqueue for campaign ${campaignId}`);
    }

    return succeeded;
}