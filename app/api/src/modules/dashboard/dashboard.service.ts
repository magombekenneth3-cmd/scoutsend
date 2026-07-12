import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { getWarmupLimit } from "../gemini/send.agent";

interface CampaignRow {
    id: string;
    name: string;
    status: string;
    createdAt: Date;
    leadsCount: bigint;
    sentCount: bigint;
    openedCount: bigint;
    repliedCount: bigint;
}

interface DomainRow {
    id: string;
    domain: string;
    health: string;
    reputationScore: number;
    currentSent: number;
    dailyLimit: number;
    bounceRate: number;
    complaintRate: number;
    warmupEnabled: boolean;
    createdAt: Date;
}

interface ActivityReply {
    id: string;
    intent: string;
    createdAt: Date;
    firstName: string | null;
    lastName: string | null;
    companyName: string;
}

interface ActivityMessage {
    id: string;
    approvalStatus: string;
    createdAt: Date;
}

interface ActivitySentMessage {
    id: string;
    sentAt: Date;
}

interface ActivityRejectedMessage {
    id: string;
    updatedAt: Date;
}

interface ActivityCampaign {
    id: string;
    name: string;
    status: string;
    createdAt: Date;
}

export async function getDashboardStats(userId: string) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const prev7End = new Date(todayStart);
    prev7End.setDate(prev7End.getDate() - 7);
    const prev7Start = new Date(prev7End);
    prev7Start.setDate(prev7Start.getDate() - 7);

    const [
        kpis,
        prevKpis,
        campaignRows,
        domainRows,
        recentReplies,
        recentApprovedMessages,
        activeCampaignEvents,
        pendingCount,
        recentSentMessages,
        recentRejectedMessages,
    ] = await Promise.all([
        prisma.$queryRaw<[{
            active_campaigns: bigint;
            emails_sent_today: bigint;
            total_sent: bigint;
            opened_count: bigint;
            replied_count: bigint;
            total_replies: bigint;
            positive_replies: bigint;
        }]>`
            SELECT
                (SELECT COUNT(*) FROM "Campaign"
                 WHERE "createdById" = ${userId}
                   AND "deletedAt" IS NULL
                   AND "status" IN ('RESEARCHING','GENERATING','REVIEW','QUEUED','SENDING')
                ) AS active_campaigns,

                (SELECT COUNT(*) FROM "OutreachMessage" om
                 JOIN "Lead" l ON l."id" = om."leadId"
                 JOIN "Campaign" c ON c."id" = l."campaignId"
                 WHERE c."createdById" = ${userId}
                   AND c."deletedAt" IS NULL
                   AND om."deliveryState" IN ('SENT','DELIVERED','OPENED','REPLIED')
                   AND COALESCE(om."sentAt", om."createdAt") >= ${todayStart}
                ) AS emails_sent_today,

                (SELECT COUNT(*) FROM "OutreachMessage" om
                 JOIN "Lead" l ON l."id" = om."leadId"
                 JOIN "Campaign" c ON c."id" = l."campaignId"
                 WHERE c."createdById" = ${userId}
                   AND c."deletedAt" IS NULL
                   AND om."deliveryState" IN ('SENT','DELIVERED','OPENED','REPLIED')
                ) AS total_sent,

                (SELECT COUNT(*) FROM "OutreachMessage" om
                 JOIN "Lead" l ON l."id" = om."leadId"
                 JOIN "Campaign" c ON c."id" = l."campaignId"
                 WHERE c."createdById" = ${userId}
                   AND c."deletedAt" IS NULL
                   AND om."deliveryState" IN ('OPENED','REPLIED')
                ) AS opened_count,

                (SELECT COUNT(*) FROM "OutreachMessage" om
                 JOIN "Lead" l ON l."id" = om."leadId"
                 JOIN "Campaign" c ON c."id" = l."campaignId"
                 WHERE c."createdById" = ${userId}
                   AND c."deletedAt" IS NULL
                   AND om."deliveryState" = 'REPLIED'
                ) AS replied_count,

                (SELECT COUNT(*) FROM "Reply" r
                 JOIN "Lead" l ON l."id" = r."leadId"
                 JOIN "Campaign" c ON c."id" = l."campaignId"
                 WHERE c."createdById" = ${userId}
                   AND c."deletedAt" IS NULL
                   AND r."deletedAt" IS NULL
                ) AS total_replies,

                (SELECT COUNT(*) FROM "Reply" r
                 JOIN "Lead" l ON l."id" = r."leadId"
                 JOIN "Campaign" c ON c."id" = l."campaignId"
                 WHERE c."createdById" = ${userId}
                   AND c."deletedAt" IS NULL
                   AND r."deletedAt" IS NULL
                   AND r."intent" IN ('POSITIVE','MEETING_REQUEST')
                ) AS positive_replies
        `,

        prisma.$queryRaw<[{
            prev_sent: bigint;
            prev_opened: bigint;
            prev_replied: bigint;
            prev_replies: bigint;
            prev_positive: bigint;
        }]>`
            SELECT
                COUNT(*) FILTER (
                    WHERE om."deliveryState" IN ('SENT','DELIVERED','OPENED','REPLIED')
                ) AS prev_sent,
                COUNT(*) FILTER (
                    WHERE om."deliveryState" IN ('OPENED','REPLIED')
                ) AS prev_opened,
                COUNT(*) FILTER (
                    WHERE om."deliveryState" = 'REPLIED'
                ) AS prev_replied,
                (SELECT COUNT(*) FROM "Reply" r2
                 JOIN "Lead" l2 ON l2."id" = r2."leadId"
                 JOIN "Campaign" c2 ON c2."id" = l2."campaignId"
                 WHERE c2."createdById" = ${userId}
                   AND c2."deletedAt" IS NULL
                   AND r2."deletedAt" IS NULL
                   AND r2."createdAt" >= ${prev7Start}
                   AND r2."createdAt" < ${prev7End}
                ) AS prev_replies,
                (SELECT COUNT(*) FROM "Reply" r2
                 JOIN "Lead" l2 ON l2."id" = r2."leadId"
                 JOIN "Campaign" c2 ON c2."id" = l2."campaignId"
                 WHERE c2."createdById" = ${userId}
                   AND c2."deletedAt" IS NULL
                   AND r2."deletedAt" IS NULL
                   AND r2."intent" IN ('POSITIVE','MEETING_REQUEST')
                   AND r2."createdAt" >= ${prev7Start}
                   AND r2."createdAt" < ${prev7End}
                ) AS prev_positive
            FROM "OutreachMessage" om
            JOIN "Lead" l ON l."id" = om."leadId"
            JOIN "Campaign" c ON c."id" = l."campaignId"
            WHERE c."createdById" = ${userId}
              AND c."deletedAt" IS NULL
              AND om."sentAt" >= ${prev7Start}
              AND om."sentAt" < ${prev7End}
        `,

        prisma.$queryRaw<CampaignRow[]>`
            SELECT
                c."id",
                c."name",
                c."status",
                c."createdAt",
                (SELECT COUNT(*) FROM "Lead" l WHERE l."campaignId" = c."id" AND l."deletedAt" IS NULL) AS "leadsCount",
                (SELECT COUNT(*) FROM "OutreachMessage" om JOIN "Lead" l ON l."id" = om."leadId" WHERE l."campaignId" = c."id" AND om."deliveryState" IN ('SENT','DELIVERED','OPENED','REPLIED')) AS "sentCount",
                (SELECT COUNT(*) FROM "OutreachMessage" om JOIN "Lead" l ON l."id" = om."leadId" WHERE l."campaignId" = c."id" AND om."deliveryState" IN ('OPENED','REPLIED')) AS "openedCount",
                (SELECT COUNT(*) FROM "OutreachMessage" om JOIN "Lead" l ON l."id" = om."leadId" WHERE l."campaignId" = c."id" AND om."deliveryState" = 'REPLIED') AS "repliedCount"
            FROM "Campaign" c
            WHERE c."createdById" = ${userId}
              AND c."deletedAt" IS NULL
            ORDER BY c."createdAt" DESC
            LIMIT 10
        `,

        prisma.$queryRaw<DomainRow[]>`
            SELECT "id", "domain", "health", "reputationScore", "currentSent", "dailyLimit", "bounceRate", "complaintRate", "warmupEnabled", "createdAt"
            FROM "SenderDomain"
            WHERE "createdById" = ${userId}
            ORDER BY "createdAt" DESC
            LIMIT 6
        `,

        prisma.$queryRaw<ActivityReply[]>`
            SELECT r."id", r."intent", r."createdAt",
                   l."firstName", l."lastName", l."companyName"
            FROM "Reply" r
            JOIN "Lead" l ON l."id" = r."leadId"
            JOIN "Campaign" c ON c."id" = l."campaignId"
            WHERE c."createdById" = ${userId}
              AND c."deletedAt" IS NULL
              AND r."deletedAt" IS NULL
            ORDER BY r."createdAt" DESC
            LIMIT 5
        `,

        prisma.$queryRaw<ActivityMessage[]>`
            SELECT om."id", om."approvalStatus", om."createdAt"
            FROM "OutreachMessage" om
            JOIN "Lead" l ON l."id" = om."leadId"
            JOIN "Campaign" c ON c."id" = l."campaignId"
            WHERE c."createdById" = ${userId}
              AND c."deletedAt" IS NULL
              AND om."approvalStatus" = 'APPROVED'
            ORDER BY om."createdAt" DESC
            LIMIT 3
        `,

        prisma.$queryRaw<ActivityCampaign[]>`
            SELECT "id", "name", "status", "createdAt"
            FROM "Campaign"
            WHERE "createdById" = ${userId}
              AND "deletedAt" IS NULL
              AND "status" IN ('SENDING','RESEARCHING')
            ORDER BY "createdAt" DESC
            LIMIT 4
        `,

        prisma.$queryRaw<[{ count: bigint }]>`
            SELECT COUNT(*) as count
            FROM "OutreachMessage" om
            JOIN "Lead" l ON l."id" = om."leadId"
            JOIN "Campaign" c ON c."id" = l."campaignId"
            WHERE c."createdById" = ${userId}
              AND c."deletedAt" IS NULL
              AND om."approvalStatus" = 'PENDING'
        `,

        prisma.$queryRaw<ActivitySentMessage[]>`
            SELECT om."id", om."sentAt"
            FROM "OutreachMessage" om
            JOIN "Lead" l ON l."id" = om."leadId"
            JOIN "Campaign" c ON c."id" = l."campaignId"
            WHERE c."createdById" = ${userId}
              AND c."deletedAt" IS NULL
              AND om."deliveryState" IN ('SENT','DELIVERED','OPENED','REPLIED')
              AND om."sentAt" IS NOT NULL
            ORDER BY om."sentAt" DESC
            LIMIT 3
        `,

        prisma.$queryRaw<ActivityRejectedMessage[]>`
            SELECT om."id", om."updatedAt"
            FROM "OutreachMessage" om
            JOIN "Lead" l ON l."id" = om."leadId"
            JOIN "Campaign" c ON c."id" = l."campaignId"
            WHERE c."createdById" = ${userId}
              AND c."deletedAt" IS NULL
              AND om."approvalStatus" = 'REJECTED'
            ORDER BY om."updatedAt" DESC
            LIMIT 3
        `,
    ]);

    const row = kpis[0];
    const totalSent = Number(row.total_sent);
    const openedCount = Number(row.opened_count);
    const repliedCount = Number(row.replied_count);
    const totalReplies = Number(row.total_replies);
    const positiveReplies = Number(row.positive_replies);

    const openRate = totalSent > 0 ? Math.round((openedCount / totalSent) * 1000) / 10 : 0;
    const replyRate = totalSent > 0 ? Math.round((repliedCount / totalSent) * 1000) / 10 : 0;
    const positiveIntentRate = totalReplies > 0 ? Math.round((positiveReplies / totalReplies) * 1000) / 10 : 0;

    const prev = prevKpis[0];
    const prevSent = Number(prev.prev_sent);
    const prevOpened = Number(prev.prev_opened);
    const prevReplied = Number(prev.prev_replied);
    const prevReplies = Number(prev.prev_replies);
    const prevPositive = Number(prev.prev_positive);

    const prevOpenRate = prevSent > 0 ? (prevOpened / prevSent) * 100 : 0;
    const prevReplyRate = prevSent > 0 ? (prevReplied / prevSent) * 100 : 0;
    const prevPositiveIntentRate = prevReplies > 0 ? (prevPositive / prevReplies) * 100 : 0;

    function delta(curr: number, prev: number): number | null {
        if (prev === 0 && curr === 0) return null;
        return Math.round((curr - prev) * 10) / 10;
    }

    const campaigns = campaignRows.map((c) => {
        const sent = Number(c.sentCount);
        const opens = Number(c.openedCount);
        const reps = Number(c.repliedCount);
        return {
            id: c.id,
            name: c.name,
            status: c.status,
            leadsCount: Number(c.leadsCount),
            sentCount: sent,
            openRate: sent > 0 ? Math.round((opens / sent) * 1000) / 10 : 0,
            replyRate: sent > 0 ? Math.round((reps / sent) * 1000) / 10 : 0,
            createdAt: c.createdAt.toISOString(),
        };
    });

    const domains = domainRows.map((d) => ({
        id: d.id,
        domain: d.domain,
        health: d.health,
        reputationScore: d.reputationScore,
        currentSent: d.currentSent,
        dailyLimit: d.dailyLimit,
        bounceRate: d.bounceRate,
        warmupEnabled: d.warmupEnabled,
        warmupLimit: getWarmupLimit({
            dailyLimit: d.dailyLimit,
            warmupEnabled: d.warmupEnabled,
            createdAt: d.createdAt,
            bounceRate: d.bounceRate,
            complaintRate: d.complaintRate,
            health: d.health,
        }),
    }));

    const activityEvents: {
        id: string;
        type: string;
        message: string;
        detail?: string;
        timestamp: string;
        timestampIso: string;
    }[] = [];

    for (const r of recentReplies) {
        const name = [r.firstName, r.lastName].filter(Boolean).join(" ") || r.companyName || "Unknown lead";
        const isPositive = ["POSITIVE", "MEETING_REQUEST"].includes(r.intent);
        activityEvents.push({
            id: `reply-${r.id}`,
            type: "REPLY_RECEIVED",
            message: isPositive ? `Positive reply from ${name}` : `Reply received from ${name}`,
            detail: r.intent.replace("_", " ").toLowerCase(),
            timestamp: r.createdAt.toISOString(),
            timestampIso: r.createdAt.toISOString(),
        });
    }

    for (const c of activeCampaignEvents) {
        activityEvents.push({
            id: `campaign-${c.id}`,
            type: "CAMPAIGN_STARTED",
            message: `Campaign "${c.name}" is ${c.status.toLowerCase()}`,
            timestamp: c.createdAt.toISOString(),
            timestampIso: c.createdAt.toISOString(),
        });
    }

    for (const m of recentApprovedMessages) {
        activityEvents.push({
            id: `approved-${m.id}`,
            type: "MESSAGE_APPROVED",
            message: "Message approved for sending",
            timestamp: m.createdAt.toISOString(),
            timestampIso: m.createdAt.toISOString(),
        });
    }

    for (const m of recentSentMessages) {
        activityEvents.push({
            id: `sent-${m.id}`,
            type: "EMAIL_SENT",
            message: "Email delivered to lead",
            timestamp: m.sentAt.toISOString(),
            timestampIso: m.sentAt.toISOString(),
        });
    }

    for (const m of recentRejectedMessages) {
        activityEvents.push({
            id: `rejected-${m.id}`,
            type: "MESSAGE_REJECTED",
            message: "Message rejected — pending review",
            timestamp: m.updatedAt.toISOString(),
            timestampIso: m.updatedAt.toISOString(),
        });
    }

    activityEvents.sort((a, b) => new Date(b.timestampIso).getTime() - new Date(a.timestampIso).getTime());

    return {
        activeCampaigns: Number(row.active_campaigns),
        emailsSentToday: Number(row.emails_sent_today),
        openRate,
        replyRate,
        positiveIntentRate,
        openRateDelta: delta(openRate, prevOpenRate),
        replyRateDelta: delta(replyRate, prevReplyRate),
        positiveIntentRateDelta: delta(positiveIntentRate, prevPositiveIntentRate),
        campaigns,
        domains,
        activityEvents: activityEvents.slice(0, 10),
        pendingApprovals: Number(pendingCount[0].count),
    };
}

type ChartRow = { day: Date; sent: number; opens: number; replies: number };
type Bucket = { day: string; sent: number; opens: number; replies: number };

function fillBuckets(rows: ChartRow[], days: number): Bucket[] {
    const buckets = new Map<string, Bucket>();
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() - i);
        d.setUTCHours(0, 0, 0, 0);
        const key = d.toISOString().slice(0, 10);
        buckets.set(key, {
            day: d.toLocaleDateString("en-US", {
                timeZone: "UTC",
                weekday: "short",
                month: "short",
                day: "numeric",
            }),
            sent: 0, opens: 0, replies: 0,
        });
    }
    for (const row of rows) {
        const key = new Date(row.day).toISOString().slice(0, 10);
        const bucket = buckets.get(key);
        if (bucket) {
            bucket.sent = row.sent;
            bucket.opens = row.opens;
            bucket.replies = row.replies;
        }
    }
    return Array.from(buckets.values());
}

export async function getDashboardPipelineChart(
    userId: string,
    days: number,
    campaignId?: string,
) {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - days);
    since.setUTCHours(0, 0, 0, 0);

    const rows = campaignId
        ? (await prisma.$queryRaw(Prisma.sql`
            SELECT
                DATE(COALESCE(m."sentAt", m."openedAt", m."repliedAt")) AS day,
                COUNT(*) FILTER (WHERE m."sentAt"    IS NOT NULL AND m."sentAt"    >= ${since})::int AS sent,
                COUNT(*) FILTER (WHERE m."openedAt"  IS NOT NULL AND m."openedAt"  >= ${since})::int AS opens,
                COUNT(*) FILTER (WHERE m."repliedAt" IS NOT NULL AND m."repliedAt" >= ${since})::int AS replies
            FROM "OutreachMessage" m
            INNER JOIN "Lead" l ON l."id" = m."leadId"
            INNER JOIN "Campaign" c ON c."id" = l."campaignId"
            WHERE c."createdById" = ${userId}
              AND l."campaignId"  = ${campaignId}
              AND c."deletedAt" IS NULL
              AND (m."sentAt" >= ${since} OR m."openedAt" >= ${since} OR m."repliedAt" >= ${since})
            GROUP BY DATE(COALESCE(m."sentAt", m."openedAt", m."repliedAt"))
            ORDER BY day ASC
          `) as ChartRow[])
        : (await prisma.$queryRaw(Prisma.sql`
            SELECT
                DATE(COALESCE(m."sentAt", m."openedAt", m."repliedAt")) AS day,
                COUNT(*) FILTER (WHERE m."sentAt"    IS NOT NULL AND m."sentAt"    >= ${since})::int AS sent,
                COUNT(*) FILTER (WHERE m."openedAt"  IS NOT NULL AND m."openedAt"  >= ${since})::int AS opens,
                COUNT(*) FILTER (WHERE m."repliedAt" IS NOT NULL AND m."repliedAt" >= ${since})::int AS replies
            FROM "OutreachMessage" m
            INNER JOIN "Lead" l ON l."id" = m."leadId"
            INNER JOIN "Campaign" c ON c."id" = l."campaignId"
            WHERE c."createdById" = ${userId}
              AND c."deletedAt" IS NULL
              AND (m."sentAt" >= ${since} OR m."openedAt" >= ${since} OR m."repliedAt" >= ${since})
            GROUP BY DATE(COALESCE(m."sentAt", m."openedAt", m."repliedAt"))
            ORDER BY day ASC
          `) as ChartRow[]);

    return fillBuckets(rows, days);
}