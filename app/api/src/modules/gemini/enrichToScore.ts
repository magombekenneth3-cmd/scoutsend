import pLimit from "p-limit";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { runBatchEmailEnrichmentAgent } from "./email-enrichment.agent";
import { runEnrichmentWaterfall } from "./enrichment-waterfall.agent";
import { runBatchLeadScoringAgent } from "./lead-scoring.agent";
import { EMAIL_STATUS } from "./email-enrichment.agent";

const ENRICH_CONCURRENCY = 5;
const SCORE_BATCH_SIZE = 10;
const RESCORE_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}


export async function enrichThenScore(
    leadIds: string[],
    campaignId: string,
): Promise<{ enriched: number; scored: number; failed: number }> {
    if (leadIds.length === 0) return { enriched: 0, scored: 0, failed: 0 };

    const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { icpDescription: true, createdById: true },
    });

    if (!campaign) {
        logger.warn({ campaignId }, "[enrich-then-score] Campaign not found — aborting");
        return { enriched: 0, scored: 0, failed: 0 };
    }

    const userId = campaign.createdById;

    let enriched = 0;
    let scored = 0;
    let failed = 0;

    try {
        await runBatchEmailEnrichmentAgent(leadIds);
    } catch (err) {
        logger.error({ err, campaignId, count: leadIds.length }, "[enrich-then-score] Email enrichment batch failed");
    }


    const waterfallLimit = pLimit(ENRICH_CONCURRENCY);

    await Promise.allSettled(
        leadIds.map(leadId =>
            waterfallLimit(async () => {
                try {
                    await runEnrichmentWaterfall(leadId, userId);
                    enriched++;
                } catch (err) {
                    logger.warn({ err, leadId }, "[enrich-then-score] Waterfall enrichment failed for lead");
                    failed++;
                }
            }),
        ),
    );


    for (let i = 0; i < leadIds.length; i += SCORE_BATCH_SIZE) {
        const chunk = leadIds.slice(i, i + SCORE_BATCH_SIZE);
        try {
            await runBatchLeadScoringAgent(chunk, campaign.icpDescription, true);
            scored += chunk.length;
        } catch (err) {
            logger.warn({ err, chunk }, "[enrich-then-score] Rescore batch failed");
            failed += chunk.length;
        }

        if (i + SCORE_BATCH_SIZE < leadIds.length) {
            await sleep(RESCORE_DELAY_MS);
        }
    }

    logger.info({ campaignId, total: leadIds.length, enriched, scored, failed }, "[enrich-then-score] Complete");

    return { enriched, scored, failed };
}