import { Queue } from "bullmq";
import { redisConnectionOptions } from "../../lib/ioredis";
import { logger } from "../../lib/logger";
import { registerForShutdown } from "./worker-runtime";
import { QUEUE_POLICY } from "./queue-policy";

export interface CompanyScrapeJobData {
    leadId: string;
    companyId: string;
    website: string;
    forceRefresh: boolean;
}

export const companyScrapeQueue = new Queue<CompanyScrapeJobData>(
    QUEUE_POLICY.companyScrape.queueName,
    {
        connection: redisConnectionOptions,
        defaultJobOptions: QUEUE_POLICY.companyScrape.defaultJobOptions,
    },
);
registerForShutdown(companyScrapeQueue);

/**
 * Enqueue a single company homepage scrape.
 *
 * Deduped by companyId via jobId — if a scrape for this company is already
 * waiting/active/delayed, this is a no-op until that job clears (completes
 * and is reaped, or fails out). Never throws: enqueue failures are logged
 * and swallowed, since company context is supplementary (consumed later by
 * email generation) and shouldn't fail the caller's enrichment flow.
 */
export async function enqueueCompanyScrape(params: {
    leadId: string;
    companyId: string;
    website: string;
    forceRefresh?: boolean;
}): Promise<void> {
    const { leadId, companyId, website, forceRefresh = false } = params;
    try {
        await companyScrapeQueue.add(
            "scrape-company",
            { leadId, companyId, website, forceRefresh },
            { jobId: `company-scrape-${companyId}` },
        );
    } catch (err) {
        logger.error({ err, leadId, companyId }, "[company-scrape] Failed to enqueue scrape job");
    }
}

/**
 * Bulk variant for batch enrichment paths. Multiple leads often share a
 * company, so this collapses to one job per companyId before calling
 * addBulk — BullMQ's jobId dedup then also coalesces against anything
 * already queued from a concurrent/overlapping batch. Returns the number
 * of jobs actually added (0 on total failure, logged internally).
 */
export async function enqueueCompanyScrapes(
    items: Array<{ leadId: string; companyId: string; website: string; forceRefresh?: boolean }>,
): Promise<number> {
    if (items.length === 0) return 0;

    const seenCompanyIds = new Set<string>();
    const jobs = items
        .filter((item) => {
            if (seenCompanyIds.has(item.companyId)) return false;
            seenCompanyIds.add(item.companyId);
            return true;
        })
        .map((item) => ({
            name: "scrape-company",
            data: {
                leadId: item.leadId,
                companyId: item.companyId,
                website: item.website,
                forceRefresh: item.forceRefresh ?? false,
            },
            opts: { jobId: `company-scrape-${item.companyId}` },
        }));

    try {
        const added = await companyScrapeQueue.addBulk(jobs);
        return added.length;
    } catch (err) {
        logger.error({ err, count: jobs.length }, "[company-scrape] Failed to enqueue bulk scrape jobs");
        return 0;
    }
}
