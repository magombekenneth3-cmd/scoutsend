import { PipelineStage } from "@prisma/client";
import { prisma } from "../prisma";
import { logger } from "../logger";

const STAGE_PRIORITY: Record<PipelineStage, number> = {
    PROSPECT: 0,
    ENGAGED: 1,
    HOT: 2,
    MEETING_BOOKED: 3,
    DISQUALIFIED: -1,
};

export async function recomputeCompanyEngagement(companyId: string | null | undefined): Promise<void> {
    if (!companyId) return;

    try {
        const leads = await prisma.lead.findMany({
            where: { companyId, deletedAt: null },
            select: {
                pipelineStage: true,
                updatedAt: true,
                _count: { select: { replies: true } },
                outreachMessages: {
                    select: { sentAt: true, openedAt: true, updatedAt: true },
                },
            },
        });

        if (leads.length === 0) {
            await prisma.companyEngagement.deleteMany({ where: { companyId } });
            return;
        }

        let engagedLeads = 0;
        let repliedLeads = 0;
        let positiveLeads = 0;
        let meetingsBooked = 0;
        let emailsSent = 0;
        let emailsOpened = 0;
        let bestPipelineStage: PipelineStage = "PROSPECT";
        let lastActivityAt: Date | null = null;

        const bump = (candidate: Date | null | undefined) => {
            if (candidate && (!lastActivityAt || candidate > lastActivityAt)) {
                lastActivityAt = candidate;
            }
        };

        for (const lead of leads) {
            if (lead.pipelineStage !== "PROSPECT") engagedLeads++;
            if (lead._count.replies > 0) repliedLeads++;
            if (lead.pipelineStage === "HOT" || lead.pipelineStage === "MEETING_BOOKED") positiveLeads++;
            if (lead.pipelineStage === "MEETING_BOOKED") meetingsBooked++;

            if (STAGE_PRIORITY[lead.pipelineStage] > STAGE_PRIORITY[bestPipelineStage]) {
                bestPipelineStage = lead.pipelineStage;
            }

            bump(lead.updatedAt);

            for (const message of lead.outreachMessages) {
                if (message.sentAt) {
                    emailsSent++;
                    bump(message.updatedAt);
                }
                if (message.openedAt) {
                    emailsOpened++;
                    bump(message.openedAt);
                }
            }
        }

        await prisma.companyEngagement.upsert({
            where: { companyId },
            create: {
                companyId,
                totalLeads: leads.length,
                engagedLeads,
                repliedLeads,
                positiveLeads,
                meetingsBooked,
                emailsSent,
                emailsOpened,
                bestPipelineStage,
                lastActivityAt,
            },
            update: {
                totalLeads: leads.length,
                engagedLeads,
                repliedLeads,
                positiveLeads,
                meetingsBooked,
                emailsSent,
                emailsOpened,
                bestPipelineStage,
                lastActivityAt,
            },
        });
    } catch (err) {
        logger.error({ err, companyId }, "[company-engagement] Failed to recompute engagement");
    }
}