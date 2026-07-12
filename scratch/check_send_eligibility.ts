import "dotenv/config";
import { prisma } from "../app/api/src/lib/prisma";

const CAMPAIGN_ID = "cmqo7nvda0000qp1zibylbjrq";

async function main() {
    const campaign = await prisma.campaign.findUniqueOrThrow({
        where: { id: CAMPAIGN_ID },
        select: {
            catchAllPolicy: true,
            sendWindowStart: true,
            sendWindowEnd: true,
            sendWindowDays: true,
            timezone: true,
        },
    });
    console.log("Campaign config:", campaign);

    const messages = await prisma.outreachMessage.findMany({
        where: { lead: { campaignId: CAMPAIGN_ID } },
        select: {
            id: true,
            approvalStatus: true,
            deliveryState: true,
            nextRetryAt: true,
            retryCount: true,
            lastError: true,
            isFollowUp: true,
            lead: {
                select: {
                    email: true,
                    emailStatus: true,
                    recommendedAction: true,
                    emailCatchAll: true,
                    replies: { select: { intent: true } },
                },
            },
        },
    });

    console.log(`\n=== ${messages.length} message(s) for this campaign ===`);
    for (const m of messages) {
        const hasBlockingReply = m.lead.replies.some((r) => r.intent !== "OUT_OF_OFFICE");
        console.log({
            messageId: m.id,
            approvalStatus: m.approvalStatus,
            deliveryState: m.deliveryState,
            nextRetryAt: m.nextRetryAt,
            retryCount: m.retryCount,
            lastError: m.lastError,
            lead_email: m.lead.email,
            lead_emailStatus: m.lead.emailStatus,
            lead_recommendedAction: m.lead.recommendedAction,
            lead_emailCatchAll: m.lead.emailCatchAll,
            catchAllPolicy: campaign.catchAllPolicy,
            replyCount: m.lead.replies.length,
            hasBlockingReply,
        });
    }

    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: campaign.timezone ?? "UTC",
        hour: "numeric",
        hour12: false,
        weekday: "short",
    }).formatToParts(now);
    console.log("\nCurrent time in campaign tz:", parts.map((p) => `${p.type}=${p.value}`).join(" "));
    console.log("Send window: hours", campaign.sendWindowStart ?? 7, "-", campaign.sendWindowEnd ?? 17,
        "| days", campaign.sendWindowDays?.length ? campaign.sendWindowDays : "[1,2,3,4,5] (default)");
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());