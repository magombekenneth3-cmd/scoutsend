import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { upsertCompany, upsertCompanySignal, extractDomain } from "../../../lib/company/company.upsert";
import { isPrismaUniqueViolation, emailToDomain } from "./discovery";
import type { DiscoveredLead, LeadInsertOutcome } from "./discovery.types";

export async function insertLead(
    lead: DiscoveredLead,
    campaignId: string,
): Promise<LeadInsertOutcome> {
    const leadDomain = extractDomain(lead.website) ?? (lead.email ? emailToDomain(lead.email) : null);

    try {
        const companyId = await upsertCompany({
            name: lead.companyName,
            website: lead.website,
            linkedinUrl: lead.linkedinUrl,
        });

        const signalResult = await upsertCompanySignal({
            companyId,
            signalType: lead.signalType,
            value: lead.signalValue,
            confidence: lead.rawConfidence,
            source: lead.source,
            explanation: lead.explanation,
        });

        const signalIsNew: boolean = signalResult?.isNew ?? false;

        let leadId: string;
        try {
            const created = await prisma.$transaction(tx =>
                tx.lead.create({
                    data: {
                        companyName: lead.companyName,
                        website: lead.website,
                        domain: leadDomain,
                        linkedinUrl: lead.linkedinUrl,
                        firstName: lead.firstName,
                        lastName: lead.lastName,
                        title: lead.title,
                        email: lead.email,
                        externalId: lead.externalId,
                        source: lead.source,
                        campaignId,
                        companyId,
                        enrichmentData: {
                            discoveredAt: new Date().toISOString(),
                            discoverySource: lead.source,
                            rawConfidence: lead.rawConfidence,
                            sourceWeight: lead.sourceWeight,
                            weightedScore: lead.weightedScore,
                        } as unknown as Prisma.InputJsonValue,
                    },
                    select: { id: true },
                })
            );
            leadId = created.id;
        } catch (createErr) {
            if (isPrismaUniqueViolation(createErr)) {
                return { status: "skipped", companyId, signalIsNew };
            }
            throw createErr;
        }

        return { status: "created", companyId, leadId, signalIsNew, domain: leadDomain, lead };
    } catch (err) {
        return { status: "failed", companyName: lead.companyName, error: err };
    }
}