import { prisma } from "../../lib/prisma";
import type {
    Prisma,
    CampaignStatus,
    DomainHealth,
    DeliveryState,
    DeliverabilityEventType,
    DeliverabilityEventSeverity,
} from "@prisma/client";
import { callGemini, extractJSON, MODELS } from "./gemini.client";
import { logger } from "../../lib/logger";
import { DOMAIN_HEALTH_THRESHOLDS } from "../../lib/constants";
import pLimit from "p-limit";

type HealthStatus = DomainHealth;
type TrendDirection = "IMPROVING" | "STABLE" | "WORSENING";

interface HealthMetrics {
    totalSent: number;
    bounces: number;
    spamComplaints: number;
    bounceRate: number;
    complaintRate: number;
}

interface PeriodMetrics {
    windowDays: number;
    metrics: HealthMetrics;
}

interface HealthAssessment {
    summary: string;
    actions: string[];
}

type MetricsScope =
    | { kind: "campaign"; campaignId: string }
    | { kind: "mailbox"; senderMailboxId: string }
    | { kind: "domain"; senderDomainId: string };

const HEALTH_CHECK_WINDOW_DAYS = 7;
const TREND_WINDOW_DAYS = [3, 7, 14];
const MIN_SAMPLE_SIZE = 25;
const HEALTH_ALERT_THROTTLE_MS = 24 * 60 * 60 * 1000;
const PAUSABLE_STATUSES: CampaignStatus[] = ["SENDING", "QUEUED"];
const ATTEMPTED_DELIVERY_STATES: DeliveryState[] = ["SENT", "DELIVERED", "OPENED", "REPLIED", "BOUNCED", "FAILED"];
const BOUNCE_EVENT_TYPES = new Set(["BOUNCE", "SOFT_BOUNCE", "HARD_BOUNCE"]);
const REPUTATION_WEIGHTS = { BOUNCE: 300, COMPLAINT: 5000 };

const HEALTH_EVENT_TYPE: Record<Exclude<HealthStatus, "HEALTHY">, DeliverabilityEventType> = {
    WARNING: "HEALTH_WARNING",
    DEGRADED: "HEALTH_DEGRADED",
    BLOCKED: "HEALTH_BLOCKED",
};

const HEALTH_EVENT_SEVERITY: Record<Exclude<HealthStatus, "HEALTHY">, DeliverabilityEventSeverity> = {
    WARNING: "WARNING",
    DEGRADED: "WARNING",
    BLOCKED: "CRITICAL",
};

const HEALTH_EVENT_TYPES: DeliverabilityEventType[] = Object.values(HEALTH_EVENT_TYPE);

function computeStatus(metrics: HealthMetrics): HealthStatus {
    if (metrics.totalSent < MIN_SAMPLE_SIZE) {
        return "HEALTHY";
    }

    const { bounceRate, complaintRate } = metrics;

    if (
        bounceRate >= DOMAIN_HEALTH_THRESHOLDS.BOUNCE_RATE_BLOCKED ||
        complaintRate >= DOMAIN_HEALTH_THRESHOLDS.COMPLAINT_RATE_BLOCKED
    ) {
        return "BLOCKED";
    }

    if (
        bounceRate >= DOMAIN_HEALTH_THRESHOLDS.BOUNCE_RATE_DEGRADED ||
        complaintRate >= DOMAIN_HEALTH_THRESHOLDS.COMPLAINT_RATE_DEGRADED
    ) {
        return "DEGRADED";
    }

    if (
        bounceRate >= DOMAIN_HEALTH_THRESHOLDS.BOUNCE_RATE_WARNING ||
        complaintRate >= DOMAIN_HEALTH_THRESHOLDS.COMPLAINT_RATE_WARNING
    ) {
        return "WARNING";
    }

    return "HEALTHY";
}

function computeTrendDirection(trendPeriods: PeriodMetrics[]): TrendDirection {
    if (trendPeriods.length < 3) {
        return "STABLE";
    }

    const [recent, mid, baseline] = [...trendPeriods].sort((a, b) => a.windowDays - b.windowDays);

    const worsening =
        (recent.metrics.bounceRate > mid.metrics.bounceRate && mid.metrics.bounceRate > baseline.metrics.bounceRate) ||
        (recent.metrics.complaintRate > mid.metrics.complaintRate &&
            mid.metrics.complaintRate > baseline.metrics.complaintRate);

    const improving =
        recent.metrics.bounceRate < mid.metrics.bounceRate &&
        mid.metrics.bounceRate < baseline.metrics.bounceRate &&
        recent.metrics.complaintRate < mid.metrics.complaintRate &&
        mid.metrics.complaintRate < baseline.metrics.complaintRate;

    if (worsening) return "WORSENING";
    if (improving) return "IMPROVING";
    return "STABLE";
}

function computeReputationScore(metrics: HealthMetrics): number {
    return Math.max(
        0,
        100 - metrics.bounceRate * REPUTATION_WEIGHTS.BOUNCE - metrics.complaintRate * REPUTATION_WEIGHTS.COMPLAINT,
    );
}

function getHealthEventDetails(
    status: HealthStatus,
): { type: DeliverabilityEventType; severity: DeliverabilityEventSeverity } | null {
    if (status === "HEALTHY") return null;
    return { type: HEALTH_EVENT_TYPE[status], severity: HEALTH_EVENT_SEVERITY[status] };
}

function fallbackSummary(status: HealthStatus, trendDirection: TrendDirection): string {
    return `Campaign health is ${status} and the trend is ${trendDirection.toLowerCase()}. AI assessment unavailable; review metrics manually.`;
}

async function getCampaignIdsForScope(scope: MetricsScope): Promise<string[] | null> {
    if (scope.kind === "campaign") return null;

    const where =
        scope.kind === "mailbox"
            ? { senderMailboxId: scope.senderMailboxId, deletedAt: null }
            : { senderDomainId: scope.senderDomainId, deletedAt: null };

    const campaigns = await prisma.campaign.findMany({ where, select: { id: true } });
    return campaigns.map((c) => c.id);
}

async function getMetrics(scope: MetricsScope, windowDays: number): Promise<HealthMetrics> {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const campaignIds = await getCampaignIdsForScope(scope);

    if (campaignIds !== null && campaignIds.length === 0) {
        return { totalSent: 0, bounces: 0, spamComplaints: 0, bounceRate: 0, complaintRate: 0 };
    }

    const campaignWhere =
        scope.kind === "campaign" ? { campaignId: scope.campaignId } : { campaignId: { in: campaignIds! } };

    const [grouped, totalSent] = await Promise.all([
        prisma.deliverabilityEvent.groupBy({
            by: ["type"],
            where: { ...campaignWhere, createdAt: { gte: since } },
            _count: { type: true },
        }),
        prisma.outreachMessage.count({
            where: {
                lead: campaignWhere,
                deliveryState: { in: ATTEMPTED_DELIVERY_STATES },
                sentAt: { gte: since },
            },
        }),
    ]);

    let bounces = 0;
    let spamComplaints = 0;

    for (const row of grouped) {
        if (BOUNCE_EVENT_TYPES.has(row.type)) {
            bounces += row._count.type;
        } else if (row.type === "SPAM_COMPLAINT") {
            spamComplaints += row._count.type;
        }
    }

    const bounceRate = totalSent > 0 ? bounces / totalSent : 0;
    const complaintRate = totalSent > 0 ? spamComplaints / totalSent : 0;

    return { totalSent, bounces, spamComplaints, bounceRate, complaintRate };
}

async function shouldCreateHealthEvent(campaignId: string, eventType: DeliverabilityEventType): Promise<boolean> {
    const lastHealthEvent = await prisma.deliverabilityEvent.findFirst({
        where: { campaignId, type: { in: HEALTH_EVENT_TYPES } },
        orderBy: { createdAt: "desc" },
        select: { type: true, createdAt: true },
    });

    if (!lastHealthEvent) return true;
    if (lastHealthEvent.type !== eventType) return true;

    return Date.now() - lastHealthEvent.createdAt.getTime() >= HEALTH_ALERT_THROTTLE_MS;
}

async function assessHealth(params: {
    campaignId: string;
    campaignName: string;
    currentMetrics: HealthMetrics;
    status: HealthStatus;
    trendDirection: TrendDirection;
    trendPeriods: PeriodMetrics[];
}): Promise<HealthAssessment> {
    const { campaignId, campaignName, currentMetrics, status, trendDirection, trendPeriods } = params;

    const trendBlock = trendPeriods
        .map(
            (p) =>
                `${p.windowDays}-day window: sent=${p.metrics.totalSent}, bounces=${p.metrics.bounces} (${(p.metrics.bounceRate * 100).toFixed(2)}%), complaints=${p.metrics.spamComplaints} (${(p.metrics.complaintRate * 100).toFixed(3)}%)`,
        )
        .join("\n");

    try {
        const { text } = await callGemini({
            agentName: "campaign-health.assessor",
            model: MODELS.REVIEW,
            systemPrompt: `You are an email deliverability expert. Given campaign health metrics across multiple time windows and a pre-computed trend direction, explain the health situation in plain English and produce a concrete action plan. Use the provided trend direction as-is; do not infer a different one.

Return ONLY JSON:
{
  "summary": string — 1–2 sentences explaining the health situation given the status and trend,
  "actions": string[] — 2–4 specific, actionable steps the user should take (ordered by priority)
}`,
            userPrompt: `Campaign: ${campaignName} (${campaignId})
Health status: ${status}
Trend direction: ${trendDirection}

Trend analysis across time windows (shorter window = more recent):
${trendBlock}

Current ${HEALTH_CHECK_WINDOW_DAYS}-day metrics:
- Emails sent: ${currentMetrics.totalSent}
- Bounces: ${currentMetrics.bounces} (${(currentMetrics.bounceRate * 100).toFixed(2)}%)
- Spam complaints: ${currentMetrics.spamComplaints} (${(currentMetrics.complaintRate * 100).toFixed(3)}%)

Thresholds:
- Warning: bounce ≥ ${(DOMAIN_HEALTH_THRESHOLDS.BOUNCE_RATE_WARNING * 100).toFixed(1)}% | complaint ≥ ${(DOMAIN_HEALTH_THRESHOLDS.COMPLAINT_RATE_WARNING * 100).toFixed(2)}%
- Degraded: bounce ≥ ${(DOMAIN_HEALTH_THRESHOLDS.BOUNCE_RATE_DEGRADED * 100).toFixed(1)}% | complaint ≥ ${(DOMAIN_HEALTH_THRESHOLDS.COMPLAINT_RATE_DEGRADED * 100).toFixed(2)}%
- Blocked: bounce ≥ ${(DOMAIN_HEALTH_THRESHOLDS.BOUNCE_RATE_BLOCKED * 100).toFixed(1)}% | complaint ≥ ${(DOMAIN_HEALTH_THRESHOLDS.COMPLAINT_RATE_BLOCKED * 100).toFixed(2)}%`,
            metadata: { campaignId, status, trendDirection },
            temperature: 0.2,
        });

        const parsed = extractJSON<{ summary?: unknown; actions?: unknown }>(text);

        const summary =
            typeof parsed.summary === "string" && parsed.summary.trim().length > 0
                ? parsed.summary
                : fallbackSummary(status, trendDirection);

        const actions = Array.isArray(parsed.actions)
            ? parsed.actions.filter((action): action is string => typeof action === "string")
            : [];

        return { summary, actions };
    } catch (err) {
        logger.warn({ err, campaignId }, "[campaign-health.agent] Gemini health assessment failed, using fallback");
        return { summary: fallbackSummary(status, trendDirection), actions: [] };
    }
}

export async function runCampaignHealthAgent(campaignId: string): Promise<void> {
    const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { id: true, name: true, status: true, senderMailboxId: true, senderDomainId: true },
    });

    if (!campaign) {
        throw new Error(`Campaign not found: ${campaignId}`);
    }

    logger.info({ campaignId }, "[campaign-health.agent] Running health check");

    const currentMetrics = await getMetrics({ kind: "campaign", campaignId }, HEALTH_CHECK_WINDOW_DAYS);

    if (currentMetrics.totalSent < MIN_SAMPLE_SIZE) {
        logger.info(
            { campaignId, totalSent: currentMetrics.totalSent },
            "[campaign-health.agent] Insufficient data, skipping",
        );
        return;
    }

    const otherTrendPeriods = await Promise.all(
        TREND_WINDOW_DAYS.filter((windowDays) => windowDays !== HEALTH_CHECK_WINDOW_DAYS).map(async (windowDays) => ({
            windowDays,
            metrics: await getMetrics({ kind: "campaign", campaignId }, windowDays),
        })),
    );

    const trendPeriods = [{ windowDays: HEALTH_CHECK_WINDOW_DAYS, metrics: currentMetrics }, ...otherTrendPeriods].sort(
        (a, b) => a.windowDays - b.windowDays,
    );

    const status = computeStatus(currentMetrics);
    const trendDirection = computeTrendDirection(trendPeriods);
    const healthEvent = getHealthEventDetails(status);

    const [shouldCreateEvent, mailboxMetrics, domainMetrics] = await Promise.all([
        healthEvent ? shouldCreateHealthEvent(campaignId, healthEvent.type) : Promise.resolve(false),
        campaign.senderMailboxId
            ? getMetrics({ kind: "mailbox", senderMailboxId: campaign.senderMailboxId }, HEALTH_CHECK_WINDOW_DAYS)
            : Promise.resolve(null),
        campaign.senderDomainId
            ? getMetrics({ kind: "domain", senderDomainId: campaign.senderDomainId }, HEALTH_CHECK_WINDOW_DAYS)
            : Promise.resolve(null),
    ]);

    const assessment =
        healthEvent && shouldCreateEvent
            ? await assessHealth({
                campaignId,
                campaignName: campaign.name,
                currentMetrics,
                status,
                trendDirection,
                trendPeriods,
            })
            : null;

    const shouldAutoPause =
        PAUSABLE_STATUSES.includes(campaign.status) &&
        (status === "BLOCKED" || (status === "DEGRADED" && trendDirection === "WORSENING"));

    const operations: Prisma.PrismaPromise<unknown>[] = [];

    if (healthEvent && shouldCreateEvent && assessment) {
        operations.push(
            prisma.deliverabilityEvent.create({
                data: {
                    campaignId,
                    type: healthEvent.type,
                    severity: healthEvent.severity,
                    metadata: {
                        healthStatus: status,
                        trendDirection,
                        summary: assessment.summary,
                        actions: assessment.actions,
                        autoPaused: shouldAutoPause,
                        metrics: {
                            totalSent: currentMetrics.totalSent,
                            bounceRate: currentMetrics.bounceRate,
                            complaintRate: currentMetrics.complaintRate,
                        },
                        trendPeriods: trendPeriods.map((p) => ({
                            windowDays: p.windowDays,
                            bounceRate: p.metrics.bounceRate,
                            complaintRate: p.metrics.complaintRate,
                        })),
                    },
                },
            }),
        );
    }

    if (campaign.senderMailboxId && mailboxMetrics) {
        operations.push(
            prisma.senderMailbox.update({
                where: { id: campaign.senderMailboxId },
                data: {
                    health: computeStatus(mailboxMetrics),
                    bounceRate: mailboxMetrics.bounceRate,
                    complaintRate: mailboxMetrics.complaintRate,
                    reputationScore: computeReputationScore(mailboxMetrics),
                },
            }),
        );
    }

    if (campaign.senderDomainId && domainMetrics) {
        operations.push(
            prisma.senderDomain.update({
                where: { id: campaign.senderDomainId },
                data: {
                    health: computeStatus(domainMetrics),
                    bounceRate: domainMetrics.bounceRate,
                    complaintRate: domainMetrics.complaintRate,
                    reputationScore: computeReputationScore(domainMetrics),
                },
            }),
        );
    }

    if (shouldAutoPause) {
        operations.push(
            prisma.campaign.update({
                where: { id: campaignId },
                data: {
                    previousStatus: campaign.status,
                    status: "PAUSED",
                },
            }),
        );
    }

    if (operations.length > 0) {
        await prisma.$transaction(operations);
    }

    if (shouldAutoPause) {
        logger.warn(
            {
                campaignId,
                status,
                trendDirection,
                bounceRate: currentMetrics.bounceRate,
                complaintRate: currentMetrics.complaintRate,
            },
            "[campaign-health.agent] Campaign auto-paused due to health degradation",
        );
    }

    logger.info(
        {
            campaignId,
            status,
            trendDirection,
            bounceRate: currentMetrics.bounceRate,
            complaintRate: currentMetrics.complaintRate,
            autoPaused: shouldAutoPause,
        },
        "[campaign-health.agent] Health check complete",
    );
}

export async function runHealthCheckAllCampaigns(): Promise<void> {
    const campaigns = await prisma.campaign.findMany({
        where: {
            status: { in: ["SENDING", "QUEUED", "COMPLETED"] as CampaignStatus[] },
            deletedAt: null,
        },
        select: { id: true },
    });

    logger.info({ count: campaigns.length }, "[campaign-health.agent] Checking all campaigns");

    const limit = pLimit(5);

    await Promise.allSettled(
        campaigns.map((campaign) =>
            limit(async () => {
                try {
                    await runCampaignHealthAgent(campaign.id);
                } catch (err) {
                    logger.error({ err, campaignId: campaign.id }, "[campaign-health.agent] Failed for campaign");
                }
            }),
        ),
    );
}