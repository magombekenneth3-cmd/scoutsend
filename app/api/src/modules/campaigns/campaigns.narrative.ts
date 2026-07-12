import { prisma } from "../../lib/prisma";
import { ForbiddenError, NotFoundError } from "../../lib/errors";

export interface NarrativeStats {
    campaignId: string;
    campaignName: string;
    status: string;
    dailySendLimit: number;
    leadsFound: number;
    leadsScored: number;
    leadsQualified: number;
    leadsDisqualified: number;
    messagesGenerated: number;
    messagesPendingReview: number;
    sentToday: number;
    totalSent: number;
    delivered: number;
    opened: number;
    replied: number;
    engaged: number;
    hot: number;
    meetingBooked: number;
    disqualified: number;
}

export async function getCampaignNarrativeStats(
    campaignId: string,
    userId: string
): Promise<NarrativeStats> {
    const campaign = await prisma.campaign.findFirst({
        where: { id: campaignId, createdById: userId, deletedAt: null },
        select: {
            id: true,
            name: true,
            status: true,
            dailySendLimit: true,
            qualificationThreshold: true,
        },
    });

    if (!campaign) {
        const exists = await prisma.campaign.findUnique({
            where: { id: campaignId },
            select: { id: true, deletedAt: true },
        });
        if (exists && !exists.deletedAt) throw new ForbiddenError();
        throw new NotFoundError("Campaign");
    }

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const [
        pipelineRows,
        messageStats,
        sentTodayCount,
        totalLeadsCount,
        scoredCount,
        qualifiedCount,
    ] = await Promise.all([
        prisma.lead.groupBy({
            by: ["pipelineStage"],
            where: { campaignId, deletedAt: null },
            _count: { id: true },
        }),
        prisma.outreachMessage.groupBy({
            by: ["deliveryState", "approvalStatus"],
            where: { lead: { campaignId } },
            _count: { id: true },
        }),
        prisma.outreachMessage.count({
            where: { lead: { campaignId }, sentAt: { gte: todayStart } },
        }),
        prisma.lead.count({
            where: { campaignId, deletedAt: null },
        }),
        prisma.lead.count({
            where: { campaignId, deletedAt: null, qualificationScore: { not: null } },
        }),
        prisma.lead.count({
            where: {
                campaignId,
                deletedAt: null,
                qualificationScore: { gte: campaign.qualificationThreshold },
            },
        }),
    ]);

    const countByDeliveryState = (state: string) =>
        messageStats
            .filter((r) => r.deliveryState === state)
            .reduce((sum, r) => sum + r._count.id, 0);

    const countByApprovalStatus = (status: string) =>
        messageStats
            .filter((r) => r.approvalStatus === status)
            .reduce((sum, r) => sum + r._count.id, 0);

    const pipelineCounts = Object.fromEntries(
        pipelineRows.map((r) => [r.pipelineStage, r._count.id])
    ) as Record<string, number>;

    return {
        campaignId: campaign.id,
        campaignName: campaign.name,
        status: campaign.status,
        dailySendLimit: campaign.dailySendLimit,

        leadsFound: totalLeadsCount,
        leadsScored: scoredCount,
        leadsQualified: qualifiedCount,
        leadsDisqualified: scoredCount - qualifiedCount,

        messagesGenerated: messageStats.reduce((s, r) => s + r._count.id, 0),
        messagesPendingReview: countByApprovalStatus("PENDING"),

        sentToday: sentTodayCount,
        totalSent:
            countByDeliveryState("SENT") +
            countByDeliveryState("DELIVERED") +
            countByDeliveryState("OPENED") +
            countByDeliveryState("REPLIED"),
        delivered:
            countByDeliveryState("DELIVERED") +
            countByDeliveryState("OPENED") +
            countByDeliveryState("REPLIED"),
        opened:
            countByDeliveryState("OPENED") +
            countByDeliveryState("REPLIED"),
        replied: countByDeliveryState("REPLIED"),

        engaged: pipelineCounts["ENGAGED"] ?? 0,
        hot: pipelineCounts["HOT"] ?? 0,
        meetingBooked: pipelineCounts["MEETING_BOOKED"] ?? 0,
        disqualified: pipelineCounts["DISQUALIFIED"] ?? 0,
    };
}