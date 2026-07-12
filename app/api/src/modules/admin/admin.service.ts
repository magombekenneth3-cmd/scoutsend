import { prisma } from "../../lib/prisma";
import { redis } from "../../lib/ioredis";
import { campaignQueue } from "../gemini/campaign.queue";
import { emailEnrichmentQueue } from "../gemini/email-enrichment.queue";
import { logger } from "../../lib/logger";
import { CampaignStatus, DomainHealth, ReplyIntent, DeliveryState } from "@prisma/client";

interface QueueSnapshot {
    name: string;
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
    completed: number;
}

export interface SystemHealth {
    db: { ok: boolean; latencyMs: number };
    redis: { ok: boolean; latencyMs: number; memoryMb: number | null };
    queues: QueueSnapshot[];
    uptimeSeconds: number;
}

export interface PlatformStats {
    users: {
        total: number;
        admins: number;
        operators: number;
        reviewers: number;
        last7Days: number;
    };
    campaigns: {
        total: number;
        active: number;
        completed: number;
        failed: number;
    };
    leads: {
        total: number;
        last7Days: number;
    };
    messages: {
        total: number;
        sent: number;
        pending: number;
    };
    mailboxes: { total: number };
    domains: { total: number; healthy: number };
    replies: { total: number; positive: number };
}

const ACTIVE_CAMPAIGN_STATUSES: CampaignStatus[] = [
    CampaignStatus.RESEARCHING,
    CampaignStatus.GENERATING,
    CampaignStatus.REVIEW,
    CampaignStatus.QUEUED,
    CampaignStatus.SENDING,
    CampaignStatus.PAUSED,
];

const SENT_DELIVERY_STATES: DeliveryState[] = [
    DeliveryState.SENT,
    DeliveryState.DELIVERED,
    DeliveryState.OPENED,
    DeliveryState.REPLIED,
    DeliveryState.BOUNCED,
    DeliveryState.FAILED,
    DeliveryState.SUPPRESSED,
];

const POSITIVE_REPLY_INTENTS: ReplyIntent[] = [
    ReplyIntent.POSITIVE,
    ReplyIntent.MEETING_REQUEST,
];

async function snapshotQueue(
    queue: typeof campaignQueue,
    name: string
): Promise<QueueSnapshot> {
    try {
        const counts = await queue.getJobCounts(
            "waiting",
            "active",
            "delayed",
            "failed",
            "completed"
        );
        return {
            name,
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
            delayed: counts.delayed ?? 0,
            failed: counts.failed ?? 0,
            completed: counts.completed ?? 0,
        };
    } catch (err) {
        logger.warn({ name, err }, "[admin] queue snapshot failed");
        return { name, waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0 };
    }
}

export async function getSystemHealth(): Promise<SystemHealth> {
    const dbStart = Date.now();
    let dbOk = false;
    try {
        await prisma.$queryRaw`SELECT 1`;
        dbOk = true;
    } catch (err) {
        logger.warn({ err }, "[admin] db health check failed");
    }
    const dbLatencyMs = Date.now() - dbStart;

    const redisStart = Date.now();
    let redisOk = false;
    let memoryMb: number | null = null;
    try {
        await redis.ping();
        redisOk = true;
        const info = await redis.info("memory");
        const match = info.match(/used_memory:(\d+)/);
        if (match) {
            memoryMb = Math.round(Number(match[1]) / 1_048_576);
        }
    } catch (err) {
        logger.warn({ err }, "[admin] redis health check failed");
    }
    const redisLatencyMs = Date.now() - redisStart;

    const queues = await Promise.all([
        snapshotQueue(campaignQueue, "campaign-orchestration"),
        snapshotQueue(emailEnrichmentQueue, "email-enrichment"),
    ]);

    return {
        db: { ok: dbOk, latencyMs: dbLatencyMs },
        redis: { ok: redisOk, latencyMs: redisLatencyMs, memoryMb },
        queues,
        uptimeSeconds: Math.floor(process.uptime()),
    };
}

export async function getPlatformStats(): Promise<PlatformStats> {
    const since7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000);

    const [
        usersByRole,
        newUsersCount,
        campaignsByStatus,
        totalLeads,
        newLeadsCount,
        totalMessages,
        sentMessages,
        pendingMessages,
        totalMailboxes,
        totalDomains,
        healthyDomains,
        totalReplies,
        positiveReplies,
    ] = await Promise.all([
        prisma.user.groupBy({ by: ["role"], _count: { id: true } }),
        prisma.user.count({ where: { createdAt: { gte: since7Days } } }),
        prisma.campaign.groupBy({
            by: ["status"],
            where: { deletedAt: null },
            _count: { id: true },
        }),
        prisma.lead.count({ where: { deletedAt: null } }),
        prisma.lead.count({ where: { deletedAt: null, createdAt: { gte: since7Days } } }),
        prisma.outreachMessage.count(),
        prisma.outreachMessage.count({
            where: { deliveryState: { in: SENT_DELIVERY_STATES } },
        }),
        prisma.outreachMessage.count({
            where: {
                deliveryState: { in: [DeliveryState.DRAFT, DeliveryState.QUEUED] },
                approvalStatus: "APPROVED",
            },
        }),
        prisma.senderMailbox.count(),
        prisma.senderDomain.count(),
        prisma.senderDomain.count({ where: { health: DomainHealth.HEALTHY } }),
        prisma.reply.count(),
        prisma.reply.count({ where: { intent: { in: POSITIVE_REPLY_INTENTS } } }),
    ]);

    const roleMap = Object.fromEntries(usersByRole.map(r => [r.role, r._count.id]));

    const statusMap = Object.fromEntries(
        campaignsByStatus.map(c => [c.status, c._count.id])
    );
    const activeCampaigns = ACTIVE_CAMPAIGN_STATUSES.reduce(
        (sum, s) => sum + (statusMap[s] ?? 0),
        0
    );

    return {
        users: {
            total: usersByRole.reduce((sum, r) => sum + r._count.id, 0),
            admins: roleMap["ADMIN"] ?? 0,
            operators: roleMap["OPERATOR"] ?? 0,
            reviewers: roleMap["REVIEWER"] ?? 0,
            last7Days: newUsersCount,
        },
        campaigns: {
            total: campaignsByStatus.reduce((sum, c) => sum + c._count.id, 0),
            active: activeCampaigns,
            completed: statusMap[CampaignStatus.COMPLETED] ?? 0,
            failed: statusMap[CampaignStatus.FAILED] ?? 0,
        },
        leads: {
            total: totalLeads,
            last7Days: newLeadsCount,
        },
        messages: {
            total: totalMessages,
            sent: sentMessages,
            pending: pendingMessages,
        },
        mailboxes: { total: totalMailboxes },
        domains: { total: totalDomains, healthy: healthyDomains },
        replies: { total: totalReplies, positive: positiveReplies },
    };
}

export async function suspendUser(targetId: string, requesterId: string): Promise<void> {
    if (targetId === requesterId) {
        throw Object.assign(new Error("Cannot suspend yourself"), { statusCode: 403 });
    }
    const target = await prisma.user.findUnique({
        where: { id: targetId },
        select: { id: true, role: true },
    });
    if (!target) {
        throw Object.assign(new Error("User not found"), { statusCode: 404 });
    }
    if (target.role === "ADMIN") {
        throw Object.assign(new Error("Cannot suspend another admin"), { statusCode: 403 });
    }
    await prisma.user.update({
        where: { id: targetId },
        data: { tokenVersion: { increment: 1 } },
        select: { id: true },
    });
}

export async function deleteUser(targetId: string, requesterId: string): Promise<void> {
    if (targetId === requesterId) {
        throw Object.assign(new Error("Cannot delete yourself"), { statusCode: 403 });
    }
    const target = await prisma.user.findUnique({
        where: { id: targetId },
        select: { id: true, role: true },
    });
    if (!target) {
        throw Object.assign(new Error("User not found"), { statusCode: 404 });
    }
    if (target.role === "ADMIN") {
        throw Object.assign(new Error("Cannot delete another admin"), { statusCode: 403 });
    }
    await prisma.user.delete({ where: { id: targetId } });
}