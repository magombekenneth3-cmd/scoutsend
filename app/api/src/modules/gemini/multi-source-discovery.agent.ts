import pLimit from "p-limit";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { normaliseCompanyName, extractDomain } from "../../lib/company/company.upsert";
import { maintenanceQueue } from "./campaign.queue";

import { loadCheckpoint, saveCheckpoint, clearCheckpoint, isCancelled } from "./discoveryLib/Checkpoint.service";
import { apolloPeopleSearchMultiPage, apolloPersonToDiscoveredLead } from "./discoveryLib/Apollo.provider";
import {
    inferDecisionMakerTitles,
    expandAtsQueryIngredients,
    buildAtsSerperQueries,
    buildGenericHiringQuery,
    extractLeadsFromSerperResults,
    runGeminiCompanyFallback,
} from "./discoveryLib/gemini.provider";
import {
    searchAtsPostings,
    searchHiringSignals,
    searchFundingSignals,
    searchGrowthSignals,
} from "./discoveryLib/serper.provider";
import { insertLead } from "./discoveryLib/insert.service";
import { qualifyAndEnqueue, resolveQualificationThreshold } from "./discoveryLib/ranking";
import { reportProgress, reportCompleted } from "./discoveryLib/progress.service";
import { normaliseName, emailToDomain } from "./discoveryLib/discovery";
import {
    INSERT_CHUNK_SIZE,
    CHECKPOINT_LEAD_INTERVAL,
    CHECKPOINT_TIME_INTERVAL_MS,
    SCORE_BATCH_SIZE,
} from "./discoveryLib/discovery.constants";
import type { DiscoveredLead, DiscoveryRunState } from "./discoveryLib/discovery.types";

export async function runMultiSourceDiscoveryAgent(campaignId: string): Promise<void> {
    const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: {
            id: true,
            icpDescription: true,
            targetIndustry: true,
            targetRegion: true,
            enrichmentData: true,
            qualificationThreshold: true,
        },
    });

    if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

    const qualificationThreshold = resolveQualificationThreshold(campaign.qualificationThreshold);
    const enrichment = (campaign.enrichmentData ?? {}) as Record<string, unknown>;

    const seniority = Array.isArray(enrichment.seniority) ? enrichment.seniority
        : Array.isArray(enrichment.person_seniorities) ? enrichment.person_seniorities
            : undefined;
    const employeeRanges = Array.isArray(enrichment.employeeRanges) ? enrichment.employeeRanges
        : Array.isArray(enrichment.organization_num_employees_ranges) ? enrichment.organization_num_employees_ranges
            : undefined;
    const fundingStages = Array.isArray(enrichment.fundingStages) ? enrichment.fundingStages
        : Array.isArray(enrichment.organization_latest_funding_stage_cd) ? enrichment.organization_latest_funding_stage_cd
            : undefined;
    const technologies = Array.isArray(enrichment.technologies) ? enrichment.technologies
        : Array.isArray(enrichment.currently_using_any_of_technology_uids) ? enrichment.currently_using_any_of_technology_uids
            : undefined;

    const industry = campaign.targetIndustry ?? "";
    const region = campaign.targetRegion ?? "";
    const currentYear = new Date().getFullYear();

    const runRecord = await prisma.discoveryRun.create({
        data: {
            sourceType: "SERPER_SEARCH",
            status: "RUNNING",
            campaignId,
            query: `Industry: ${industry}, Region: ${region}`,
            startedAt: new Date(),
        },
    });

    const checkpoint = await loadCheckpoint(campaignId);
    if (checkpoint) {
        logger.info({ campaignId, resumedFrom: checkpoint.savedAt }, "[discovery] Resuming from checkpoint");
    }

    const state: DiscoveryRunState = {
        created: checkpoint?.created ?? 0,
        skipped: checkpoint?.skipped ?? 0,
        failed: checkpoint?.failed ?? 0,
        signalsProcessed: checkpoint?.signalsProcessed ?? 0,
        companyDomainMap: new Map(),
        createdLeadIds: checkpoint?.createdLeadIds ?? [],
        processedCompanyIds: new Set(),
        discoveredSignalsByLeadId: new Map(),
        existingCampaignDomains: new Set(checkpoint?.existingCampaignDomains ?? []),
        existingCampaignEmails: new Set(checkpoint?.existingEmails ?? []),
        resumedProcessedKeys: new Set(checkpoint?.processedLeadKeys ?? []),
    };

    try {
        logger.info({ campaignId }, "[discovery] Starting discovery run");

        const [existingDomainRows, existingEmailRows] = await Promise.all([
            prisma.lead.findMany({
                where: { campaignId, deletedAt: null, domain: { not: null } },
                select: { domain: true },
            }),
            prisma.lead.findMany({
                where: { campaignId, deletedAt: null, email: { not: null } },
                select: { email: true },
            }),
        ]);

        for (const r of existingDomainRows) state.existingCampaignDomains.add(r.domain!.toLowerCase());
        for (const r of existingEmailRows) state.existingCampaignEmails.add(r.email!.toLowerCase());

        const [inferredTitles, atsIngredients] = await Promise.all([
            inferDecisionMakerTitles(campaign.icpDescription),
            expandAtsQueryIngredients({ icpDescription: campaign.icpDescription, targetIndustry: industry }),
        ]);

        const atsQueries = buildAtsSerperQueries({ ingredients: atsIngredients, region });
        const hiringQuery = buildGenericHiringQuery({ icpDescription: campaign.icpDescription, region, currentYear });

        const [atsResults, hiringResults, fundingResults, growthResults, apolloResults] = await Promise.all([
            searchAtsPostings(atsQueries),
            searchHiringSignals(hiringQuery),
            searchFundingSignals(industry, region, currentYear),
            searchGrowthSignals(industry, region, currentYear),
            apolloPeopleSearchMultiPage({
                titles: inferredTitles,
                industry,
                region,
                seniority,
                employeeRanges,
                fundingStages,
                technologies,
            }),
        ]);

        const [jobPostingLeads, hiringLeads, fundingLeads, growthLeads] = await Promise.all([
            extractLeadsFromSerperResults({
                results: atsResults,
                icpDescription: campaign.icpDescription,
                signalType: "HIRING_SIGNAL",
                source: "job_posting",
                enforceAtsSignal: true,
            }),
            extractLeadsFromSerperResults({
                results: hiringResults,
                icpDescription: campaign.icpDescription,
                signalType: "INTENT_SIGNAL",
                source: "web_intelligence",
                enforceAtsSignal: false,
            }),
            extractLeadsFromSerperResults({
                results: fundingResults,
                icpDescription: campaign.icpDescription,
                signalType: "FUNDING_SIGNAL",
                source: "funding_news",
                enforceAtsSignal: false,
            }),
            extractLeadsFromSerperResults({
                results: growthResults,
                icpDescription: campaign.icpDescription,
                signalType: "GROWTH_SIGNAL",
                source: "web_intelligence",
                enforceAtsSignal: false,
            }),
        ]);

        const apolloLeads = apolloResults
            .map(apolloPersonToDiscoveredLead)
            .filter((l): l is DiscoveredLead => l !== null);

        const geminiLeads = apolloLeads.length === 0
            ? await runGeminiCompanyFallback({ icpDescription: campaign.icpDescription, industry, region })
            : [];

        const allDiscovered: DiscoveredLead[] = [
            ...apolloLeads,
            ...jobPostingLeads,
            ...hiringLeads,
            ...fundingLeads,
            ...growthLeads,
            ...geminiLeads,
        ];

        if (allDiscovered.length === 0) {
            logger.info({ campaignId }, "[discovery] No leads found");
            await prisma.discoveryRun.update({
                where: { id: runRecord.id },
                data: { status: "COMPLETED", companiesFound: 0, leadsFound: 0, signalsFound: 0, completedAt: new Date() },
            });
            await clearCheckpoint(campaignId);
            return;
        }

        const enrichable = allDiscovered.filter(lead => {
            if (!lead.companyName?.trim()) return false;
            const hasDomain = !!(extractDomain(lead.website) ?? lead.email);
            if (!lead.firstName && !lead.lastName && !lead.email && !lead.linkedinUrl && !hasDomain) {
                logger.info({ companyName: lead.companyName, source: lead.source }, "[discovery] Discarding lead with no identity anchor");
                return false;
            }
            return true;
        });

        const phantom = allDiscovered.length - enrichable.length;
        if (phantom > 0) {
            logger.info({ campaignId, total: allDiscovered.length, discarded: phantom }, "[discovery] Phantom leads discarded");
        }

        const seenThisRun = new Set<string>();
        const deduped = enrichable
            .filter(lead => {
                const personKey = normaliseCompanyName(lead.companyName) + normaliseName(lead.firstName) + normaliseName(lead.lastName);
                if (seenThisRun.has(personKey) || state.resumedProcessedKeys.has(personKey)) return false;
                seenThisRun.add(personKey);

                const domain = extractDomain(lead.website) ?? (lead.email ? emailToDomain(lead.email) : null);
                if (domain && state.existingCampaignDomains.has(domain.toLowerCase())) return false;
                if (lead.email && state.existingCampaignEmails.has(lead.email.toLowerCase())) return false;

                return true;
            })
            .sort((a, b) => b.weightedScore - a.weightedScore);

        logger.info(
            { campaignId, discovered: allDiscovered.length, enrichable: enrichable.length, unique: deduped.length },
            "[discovery] Deduplication complete",
        );

        const INSERT_CONCURRENCY = Number(process.env.DISCOVERY_INSERT_CONCURRENCY ?? 5);
        const insertLimit = pLimit(INSERT_CONCURRENCY);
        let processed = 0;
        let lastEmittedPct = -1;
        let lastCheckpointAt = Date.now();
        let processedSinceCheckpoint = 0;

        for (let chunkStart = 0; chunkStart < deduped.length; chunkStart += INSERT_CHUNK_SIZE) {
            if (await isCancelled(campaignId)) {
                logger.info({ campaignId, processed }, "[discovery] Cancellation detected — stopping");
                break;
            }

            const chunk = deduped.slice(chunkStart, chunkStart + INSERT_CHUNK_SIZE);

            const outcomes = await Promise.all(
                chunk.map(lead =>
                    insertLimit(async () => {
                        const outcome = await insertLead(lead, campaignId);
                        const personKey = normaliseCompanyName(lead.companyName) + normaliseName(lead.firstName) + normaliseName(lead.lastName);

                        processed++;
                        processedSinceCheckpoint++;
                        lastEmittedPct = reportProgress({ campaignId, processed, total: deduped.length, lastEmittedPct });

                        const shouldCheckpoint =
                            processedSinceCheckpoint >= CHECKPOINT_LEAD_INTERVAL ||
                            Date.now() - lastCheckpointAt >= CHECKPOINT_TIME_INTERVAL_MS;

                        if (shouldCheckpoint) {
                            state.resumedProcessedKeys.add(personKey);
                            lastCheckpointAt = Date.now();
                            processedSinceCheckpoint = 0;
                            saveCheckpoint(campaignId, {
                                processedLeadKeys: Array.from(state.resumedProcessedKeys),
                                createdLeadIds: [...state.createdLeadIds],
                                existingCampaignDomains: Array.from(state.existingCampaignDomains),
                                existingEmails: Array.from(state.existingCampaignEmails),
                                created: state.created,
                                skipped: state.skipped,
                                failed: state.failed,
                                signalsProcessed: state.signalsProcessed,
                                savedAt: new Date().toISOString(),
                            }).catch(() => { });
                        }

                        return { outcome, lead, personKey };
                    })
                ),
            );

            for (const { outcome, lead, personKey } of outcomes) {
                if (outcome.status === "created") {
                    state.created++;
                    state.createdLeadIds.push(outcome.leadId);
                    state.discoveredSignalsByLeadId.set(outcome.leadId, {
                        signalType: lead.signalType.replace("_SIGNAL", ""),
                        rawConfidence: lead.rawConfidence,
                        sourceWeight: lead.sourceWeight,
                        source: lead.source,
                    });
                    state.processedCompanyIds.add(outcome.companyId);
                    if (outcome.signalIsNew) state.signalsProcessed++;
                    if (outcome.domain) {
                        state.existingCampaignDomains.add(outcome.domain.toLowerCase());
                        state.companyDomainMap.set(outcome.companyId, outcome.domain);
                    }
                    if (lead.email) state.existingCampaignEmails.add(lead.email.toLowerCase());
                    state.resumedProcessedKeys.add(personKey);
                } else if (outcome.status === "skipped") {
                    state.skipped++;
                    state.processedCompanyIds.add(outcome.companyId);
                    if (outcome.signalIsNew) state.signalsProcessed++;
                } else {
                    state.failed++;
                    logger.warn({ err: outcome.error, companyName: outcome.companyName }, "[discovery] Failed to process lead");
                }
            }
        }

        const qualifiedCompanyDomains = await qualifyAndEnqueue({
            createdLeadIds: state.createdLeadIds,
            icpDescription: campaign.icpDescription,
            qualificationThreshold,
            state,
            campaignId,
        });

        if (qualifiedCompanyDomains.length > 0) {
            await maintenanceQueue.add(
                "populate-tech-signals",
                { campaignId, companyDomains: qualifiedCompanyDomains },
                {
                    jobId: `tech-signals-${campaignId}`,
                    attempts: 3,
                    backoff: { type: "exponential", delay: 5_000 },
                    removeOnComplete: { age: 300 },
                    removeOnFail: { age: 3600 },
                },
            );
        }

        await prisma.discoveryRun.update({
            where: { id: runRecord.id },
            data: {
                status: "COMPLETED",
                companiesFound: state.processedCompanyIds.size,
                leadsFound: state.created,
                signalsFound: state.signalsProcessed,
                completedAt: new Date(),
                ...(state.failed > 0 ? { errorMessage: `${state.failed} lead(s) failed to insert` } : {}),
            },
        });

        await clearCheckpoint(campaignId);
        reportCompleted(campaignId, state.created);

        logger.info(
            {
                campaignId,
                created: state.created,
                skipped: state.skipped,
                failed: state.failed,
                scoreBatches: Math.ceil(state.createdLeadIds.length / SCORE_BATCH_SIZE),
            },
            "[discovery] Discovery complete",
        );
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err, campaignId }, "[discovery] Run failed");

        await saveCheckpoint(campaignId, {
            processedLeadKeys: Array.from(state.resumedProcessedKeys),
            createdLeadIds: [...state.createdLeadIds],
            existingCampaignDomains: Array.from(state.existingCampaignDomains),
            existingEmails: Array.from(state.existingCampaignEmails),
            created: state.created,
            skipped: state.skipped,
            failed: state.failed,
            signalsProcessed: state.signalsProcessed,
            savedAt: new Date().toISOString(),
        });

        await prisma.discoveryRun.update({
            where: { id: runRecord.id },
            data: { status: "FAILED", errorMessage: message, completedAt: new Date() },
        });

        throw err;
    }
}