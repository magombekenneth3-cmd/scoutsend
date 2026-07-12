import { prisma } from "../../../lib/prisma";
import { logger } from "../../../lib/logger";
import { runBatchLeadScoringAgent } from "../lead-scoring.agent";
import { enqueueEnrichmentBatches } from "../email-enrichment.queue";
import { ingestSignalBatch } from "../signal-ingestion.agent";
import { extractDomain } from "../../../lib/company/company.upsert";
import {
    SCORE_BATCH_SIZE,
    QUALIFICATION_WEIGHT,
    DISCOVERY_CONFIDENCE_WEIGHT,
    SOURCE_WEIGHT_CONTRIBUTION,
    DISCOVERY_GATE_FLOOR,
} from "./discovery.constants";
import type { DiscoveryRunState } from "./discovery.types";

export function resolveQualificationThreshold(raw: number | null | undefined): number {
    if (typeof raw === "number" && raw >= 0 && raw <= 1) return raw;
    return DISCOVERY_GATE_FLOOR;
}

export async function scoreLeads(
    leadIds: string[],
    icpDescription: string,
): Promise<void> {
    const sorted = [...leadIds];

    for (let i = 0; i < sorted.length; i += SCORE_BATCH_SIZE) {
        const chunk = sorted.slice(i, i + SCORE_BATCH_SIZE);
        try {
            await runBatchLeadScoringAgent(chunk, icpDescription);
        } catch (err) {
            logger.error({ err, chunk }, "[discovery/ranking] Batch lead scoring failed");
        }
    }
}

export async function qualifyAndEnqueue(params: {
    createdLeadIds: string[];
    icpDescription: string;
    qualificationThreshold: number;
    state: DiscoveryRunState;
    campaignId: string;
}): Promise<Array<{ companyId: string; domain: string }>> {
    const { createdLeadIds, icpDescription, qualificationThreshold, state, campaignId } = params;

    await scoreLeads(createdLeadIds, icpDescription);

    const scoredLeads = await prisma.lead.findMany({
        where: { id: { in: createdLeadIds } },
        select: {
            id: true,
            qualificationScore: true,
            recommendedAction: true,
            companyId: true,
            website: true,
            enrichmentData: true,
        },
    });

    const qualifiedLeads = scoredLeads
        .map(lead => {
            const qualScore = lead.qualificationScore ?? 0;
            const ed = (lead.enrichmentData ?? {}) as Record<string, unknown>;
            const rawConfidence = typeof ed.rawConfidence === "number" ? ed.rawConfidence : 0;
            const sw = typeof ed.sourceWeight === "number" ? ed.sourceWeight : 0.65;

            const finalRankScore =
                QUALIFICATION_WEIGHT * qualScore +
                DISCOVERY_CONFIDENCE_WEIGHT * rawConfidence +
                SOURCE_WEIGHT_CONTRIBUTION * sw;

            return { ...lead, finalRankScore };
        })
        .filter(lead => {
            const score = lead.qualificationScore ?? 0;
            return lead.recommendedAction !== "DISQUALIFY" && score >= qualificationThreshold;
        })
        .sort((a, b) => b.finalRankScore - a.finalRankScore);

    const qualifiedLeadIds = qualifiedLeads.map(l => l.id);

    logger.info(
        { campaignId, total: createdLeadIds.length, qualified: qualifiedLeadIds.length, threshold: qualificationThreshold },
        "[discovery/ranking] Qualification gate complete",
    );

    if (qualifiedLeadIds.length > 0) {
        await enqueueEnrichmentBatches(qualifiedLeadIds, campaignId);

        const signalPayloads = qualifiedLeadIds
            .filter(id => state.discoveredSignalsByLeadId.has(id))
            .map(id => {
                const sig = state.discoveredSignalsByLeadId.get(id)!;
                return {
                    leadId: id,
                    signalType: sig.signalType,
                    value: `Discovered via ${sig.source}`,
                    confidence: sig.rawConfidence,
                    source: sig.source,
                };
            });

        if (signalPayloads.length > 0) {
            ingestSignalBatch(signalPayloads).catch(err =>
                logger.warn({ err }, "[discovery/ranking] Signal acceleration batch failed (non-fatal)")
            );
        }
    }

    const qualifiedCompanyDomains: Array<{ companyId: string; domain: string }> = [];
    for (const lead of qualifiedLeads) {
        if (!lead.companyId) continue;
        const domain =
            extractDomain(lead.website ?? undefined) ??
            state.companyDomainMap.get(lead.companyId);
        if (domain) qualifiedCompanyDomains.push({ companyId: lead.companyId, domain });
    }

    return qualifiedCompanyDomains;
}