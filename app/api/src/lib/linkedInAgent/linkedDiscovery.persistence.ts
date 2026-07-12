import { Prisma, PrismaClient } from "@prisma/client";
import pLimit from "p-limit";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { upsertCompany, upsertCompanySignal } from "../../lib/company/company.upsert";
import { LINKEDIN_DISCOVERY_CONFIG } from "./linkedin-discovery.config";
import type { DiscoveredLinkedInLead } from "./linked-discovery.types";

type PrismaTx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

export interface LeadPersistenceResult {
    created: number;
    skipped: number;
    failed: number;
    createdLeadIds: string[];
    processedCompanyIds: Set<string>;
    signalsCreated: number;
}

interface PersistSingleLeadOutcome {
    created: boolean;
    companyId: string;
    leadId: string | null;
}

async function persistSingleLead(
    tx: PrismaTx,
    lead: DiscoveredLinkedInLead,
    campaignId: string,
): Promise<PersistSingleLeadOutcome> {
    const companyId = await upsertCompany({ name: lead.companyName, linkedinUrl: null }, tx);

    await upsertCompanySignal(
        {
            companyId,
            signalType: "INTENT_SIGNAL",
            value: `LinkedIn Search Target: ${lead.title || "Decision Maker"}`,
            confidence: 0.8,
            source: "linkedin_discovery",
            explanation: "Found via LinkedIn people search for matching ICP role.",
        },
        tx,
    );

    const existingLead = await tx.lead.findFirst({
        where: {
            campaignId,
            OR: [
                { linkedinUrl: lead.profileUrl },
                {
                    companyId,
                    ...(lead.firstName && lead.lastName
                        ? { firstName: lead.firstName, lastName: lead.lastName }
                        : {}),
                },
            ],
        },
        select: { id: true },
    });

    if (existingLead) return { created: false, companyId, leadId: null };

    const createdLead = await tx.lead.create({
        data: {
            companyName: lead.companyName,
            linkedinUrl: lead.profileUrl,
            firstName: lead.firstName || null,
            lastName: lead.lastName || null,
            title: lead.title || null,
            source: "linkedin_discovery",
            campaignId,
            companyId,
            enrichmentData: {
                discoveredAt: new Date().toISOString(),
                discoverySource: "linkedin_discovery",
                headline: lead.headline,
                location: lead.location,
            } as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
    });

    return { created: true, companyId, leadId: createdLead.id };
}

export async function persistDiscoveredLeads(
    leads: DiscoveredLinkedInLead[],
    campaignId: string,
    onProgress?: (completed: number, total: number) => void,
): Promise<LeadPersistenceResult> {
    const limit = pLimit(LINKEDIN_DISCOVERY_CONFIG.LEAD_PERSISTENCE_CONCURRENCY);
    const result: LeadPersistenceResult = {
        created: 0,
        skipped: 0,
        failed: 0,
        createdLeadIds: [],
        processedCompanyIds: new Set<string>(),
        signalsCreated: 0,
    };

    let completed = 0;

    await Promise.all(
        leads.map(lead =>
            limit(async () => {
                try {
                    const outcome = await prisma.$transaction((tx: PrismaTx) =>
                        persistSingleLead(tx, lead, campaignId),
                    );
                    result.processedCompanyIds.add(outcome.companyId);
                    result.signalsCreated++;
                    if (outcome.created && outcome.leadId) {
                        result.created++;
                        result.createdLeadIds.push(outcome.leadId);
                    } else {
                        result.skipped++;
                    }
                } catch (err) {
                    result.failed++;
                    logger.warn(
                        { err, companyName: lead.companyName },
                        "[linkedin-discovery] Failed to process lead",
                    );
                } finally {
                    completed++;
                    try {
                        onProgress?.(completed, leads.length);
                    } catch (progressErr) {
                        logger.warn({ err: progressErr }, "[linkedin-discovery] Progress callback failed");
                    }
                }
            }),
        ),
    );

    return result;
}