import { prisma } from "./prisma";
import { PaymentRequiredError } from "./errors";

const FREE_LIMITS = { seatLimit: 3, campaignLimit: 5 };

async function getSubscriptionLimits(orgId: string) {
    const sub = await prisma.subscription.findUnique({
        where: { orgId },
        select: { seatLimit: true, campaignLimit: true, status: true, planTier: true },
    });
    if (!sub || sub.status === "CANCELED") return FREE_LIMITS;
    return { seatLimit: sub.seatLimit, campaignLimit: sub.campaignLimit };
}

export async function assertWithinSeatLimit(orgId: string): Promise<void> {
    const [limits, memberCount] = await Promise.all([
        getSubscriptionLimits(orgId),
        prisma.organizationMember.count({ where: { orgId } }),
    ]);
    if (memberCount >= limits.seatLimit) {
        throw new PaymentRequiredError(
            `Seat limit reached (${memberCount}/${limits.seatLimit}). Upgrade your plan to add more members.`
        );
    }
}

export async function assertWithinCampaignLimit(orgId: string): Promise<void> {
    const [limits, campaignCount] = await Promise.all([
        getSubscriptionLimits(orgId),
        prisma.campaign.count({ where: { orgId, deletedAt: null } }),
    ]);
    if (campaignCount >= limits.campaignLimit) {
        throw new PaymentRequiredError(
            `Campaign limit reached (${campaignCount}/${limits.campaignLimit}). Upgrade your plan to create more campaigns.`
        );
    }
}

export async function assertPlanFeature(
    orgId: string,
    feature: "LINKEDIN" | "LOOKALIKE" | "AGENT_COLUMNS"
): Promise<void> {
    const sub = await prisma.subscription.findUnique({
        where: { orgId },
        select: { planTier: true, status: true },
    });
    const tier = sub?.status === "CANCELED" ? "FREE" : (sub?.planTier ?? "FREE");

    const featureMap: Record<typeof feature, string[]> = {
        LINKEDIN: ["GROWTH", "ENTERPRISE"],
        LOOKALIKE: ["GROWTH", "ENTERPRISE"],
        AGENT_COLUMNS: ["STARTER", "GROWTH", "ENTERPRISE"],
    };

    if (!featureMap[feature].includes(tier)) {
        throw new PaymentRequiredError(
            `Feature "${feature}" is not available on the ${tier} plan. Please upgrade.`
        );
    }
}
