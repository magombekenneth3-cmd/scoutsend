import { PlanTier, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";

interface StripeSubscriptionEvent {
    type: string;
    data: {
        object: {
            id: string;
            customer: string;
            status: string;
            items: { data: Array<{ price: { metadata: { plan_tier?: string }; unit_amount?: number } }> };
            current_period_end: number;
            trial_end?: number | null;
            metadata?: { org_id?: string; seat_limit?: string; campaign_limit?: string };
        };
    };
}

function resolvePlanTier(raw: string | undefined): PlanTier {
    if (!raw) return "FREE";
    const upper = raw.toUpperCase() as PlanTier;
    const valid: PlanTier[] = ["FREE", "STARTER", "GROWTH", "ENTERPRISE"];
    return valid.includes(upper) ? upper : "FREE";
}

function resolveStatus(raw: string): SubscriptionStatus {
    const map: Record<string, SubscriptionStatus> = {
        active: "ACTIVE",
        trialing: "TRIALING",
        past_due: "PAST_DUE",
        canceled: "CANCELED",
        unpaid: "UNPAID",
    };
    return map[raw] ?? "ACTIVE";
}

export async function getSubscription(orgId: string) {
    return prisma.subscription.findUnique({ where: { orgId } });
}

export async function ensureSubscription(orgId: string) {
    const existing = await prisma.subscription.findUnique({ where: { orgId } });
    if (existing) return existing;
    return prisma.subscription.create({
        data: { orgId, planTier: "FREE", status: "ACTIVE", seatLimit: 3, campaignLimit: 5 },
    });
}

export async function upsertSubscriptionFromStripe(event: StripeSubscriptionEvent): Promise<void> {
    const obj = event.data.object;
    const orgId = obj.metadata?.org_id;

    if (!orgId) {
        logger.warn({ stripeSubId: obj.id }, "[billing] Stripe event missing org_id metadata — skipped");
        return;
    }

    const rawTier = obj.items.data[0]?.price?.metadata?.plan_tier;
    const planTier = resolvePlanTier(rawTier);
    const status = resolveStatus(obj.status);
    const seatLimit = parseInt(obj.metadata?.seat_limit ?? "3", 10);
    const campaignLimit = parseInt(obj.metadata?.campaign_limit ?? "5", 10);

    await prisma.subscription.upsert({
        where: { orgId },
        update: {
            planTier,
            status,
            stripeCustomerId: obj.customer,
            stripeSubscriptionId: obj.id,
            seatLimit: isNaN(seatLimit) ? 3 : seatLimit,
            campaignLimit: isNaN(campaignLimit) ? 5 : campaignLimit,
            currentPeriodEnd: new Date(obj.current_period_end * 1000),
            trialEndsAt: obj.trial_end ? new Date(obj.trial_end * 1000) : null,
        },
        create: {
            orgId,
            planTier,
            status,
            stripeCustomerId: obj.customer,
            stripeSubscriptionId: obj.id,
            seatLimit: isNaN(seatLimit) ? 3 : seatLimit,
            campaignLimit: isNaN(campaignLimit) ? 5 : campaignLimit,
            currentPeriodEnd: new Date(obj.current_period_end * 1000),
            trialEndsAt: obj.trial_end ? new Date(obj.trial_end * 1000) : null,
        },
    });

    logger.info({ orgId, planTier, status }, "[billing] Subscription synced from Stripe");
}
