import pLimit from "p-limit";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { runEnrichmentWaterfall } from "./enrichment-waterfall.agent";
import { runBatchLeadScoringAgent } from "./lead-scoring.agent";
import { enqueueEmailRevealForQualifiedLeads } from "./email-enrichment.queue";

const ENRICH_CONCURRENCY = 5;
const SCORE_BATCH_SIZE = 10;
const RESCORE_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function enrichThenScore(
    leadIds: string[],
    campaignId: string,
): Promise<{ enriched: number; scored: number; failed: number; revealQueued: number }> {
    if (leadIds.length === 0) return { enriched: 0, scored: 0, failed: 0, revealQueued: 0 };

    const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { icpDescription: true, createdById: true },
    });

    if (!campaign) {
        logger.warn({ campaignId }, "[enrich-then-score] Campaign not found — aborting");
        return { enriched: 0, scored: 0, failed: 0, revealQueued: 0 };
    }

    const userId = campaign.createdById;

    let enriched = 0;
    let scored = 0;
    let failed = 0;

    // 1. Non-email profile enrichment first (company + person waterfall).
    //    This is what scoring needs — industry, funding, title, seniority,
    //    tech signals — and does not perform the paid Apollo/Hunter email
    //    *reveal* (that's a separate, dedicated step below, gated on score).
    //    runEnrichmentWaterfall already skips leads enriched within the
    //    freshness window on its own, so no extra dedup is needed here.
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

    // 2. Score using whatever profile data enrichment produced.
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

    // 3. Only now, with fresh scores in hand, queue the costly reveal —
    //    and only for the subset that qualified.
    let revealQueued = 0;
    try {
        const { qualifiedIds } = await enqueueEmailRevealForQualifiedLeads(leadIds, campaignId);
        revealQueued = qualifiedIds.length;
    } catch (err) {
        logger.warn({ err, campaignId, count: leadIds.length }, "[enrich-then-score] Email reveal enqueue failed");
    }

    logger.info(
        { campaignId, total: leadIds.length, enriched, scored, failed, revealQueued },
        "[enrich-then-score] Complete",
    );

    return { enriched, scored, failed, revealQueued };
}