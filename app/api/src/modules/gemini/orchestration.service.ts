import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { runGraphPipeline, CampaignPausedError, CampaignPipelineBusyError, NoSenderError } from "./ochestration.graph";
import { verifySenderDomainDns } from "../senderDomain/senderDomain.services";
import { verifyMailboxConnection, verifyMailboxDns } from "../senderMailbox/senderMailbox.services";
import { createLinkedInProvider } from "../../lib/linkedIn";
import { logger } from "../../lib/logger";
import { redis } from "../../lib/ioredis";
import type { ResumePoint } from "./orchestration.types";

export class CampaignNotFoundError extends Error {
    readonly campaignId: string;
    constructor(campaignId: string) {
        super(`Campaign not found: ${campaignId}`);
        this.name = "CampaignNotFoundError";
        this.campaignId = campaignId;
    }
}

export class CampaignAlreadyRunningError extends Error {
    readonly campaignId: string;
    readonly currentStatus: string;
    constructor(campaignId: string, currentStatus: string) {
        super(`Campaign already running with status "${currentStatus}": ${campaignId}`);
        this.name = "CampaignAlreadyRunningError";
        this.campaignId = campaignId;
        this.currentStatus = currentStatus;
    }
}

export class CampaignAlreadyCompletedError extends Error {
    readonly campaignId: string;
    constructor(campaignId: string) {
        super(`Campaign already completed: ${campaignId}`);
        this.name = "CampaignAlreadyCompletedError";
        this.campaignId = campaignId;
    }
}

export class CampaignOwnershipError extends Error {
    readonly campaignId: string;
    constructor(campaignId: string) {
        super(`Caller does not own campaign: ${campaignId}`);
        this.name = "CampaignOwnershipError";
        this.campaignId = campaignId;
    }
}

export class CampaignInvalidStateError extends Error {
    readonly campaignId: string;
    readonly currentStatus: string;
    constructor(campaignId: string, currentStatus: string, reason: string) {
        super(`Campaign ${campaignId} in state "${currentStatus}": ${reason}`);
        this.name = "CampaignInvalidStateError";
        this.campaignId = campaignId;
        this.currentStatus = currentStatus;
    }
}

export class CampaignResumeError extends Error {
    readonly campaignId: string;
    constructor(campaignId: string, reason: string) {
        super(`Cannot resume campaign ${campaignId}: ${reason}`);
        this.name = "CampaignResumeError";
        this.campaignId = campaignId;
    }
}

export class SenderDnsError extends Error {
    readonly senderDomainId: string;
    constructor(senderDomainId: string, details: string) {
        super(`Sender domain DNS validation failed for ${senderDomainId}: ${details}`);
        this.name = "SenderDnsError";
        this.senderDomainId = senderDomainId;
    }
}

export class InvalidReviewSummaryError extends Error {
    readonly campaignId: string;
    constructor(campaignId: string) {
        super(`Graph pipeline returned an invalid result for campaign: ${campaignId}`);
        this.name = "InvalidReviewSummaryError";
        this.campaignId = campaignId;
    }
}

export class PipelineTimeoutError extends Error {
    constructor(label: string, ms: number) {
        super(`Pipeline timed out after ${ms}ms: ${label}`);
        this.name = "PipelineTimeoutError";
    }
}

const PIPELINE_TIMEOUT_MS =
    parseInt(process.env.PIPELINE_TIMEOUT_MS ?? "", 10) || 30 * 60 * 1000;

const ACTIVE_STATUSES = new Set([
    "RESEARCHING",
    "GENERATING",
    "REVIEW",
    "QUEUED",
    "SENDING",
]);

const PAUSABLE_STATUSES = ACTIVE_STATUSES;

const VALID_RESUME_POINTS = new Set<ResumePoint>([
    "RESEARCHING",
    "GENERATING",
    "REVIEW",
    "QUEUED",
    "SENDING",
]);

function isResumePoint(value: unknown): value is ResumePoint {
    return typeof value === "string" && (VALID_RESUME_POINTS as Set<string>).has(value);
}

function isValidReviewSummary(value: unknown): value is Prisma.JsonObject {
    return (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value as object).length > 0
    );
}

async function withTimeout<T>(
    factory: (signal: AbortSignal) => Promise<T>,
    ms: number,
    label: string,
): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            controller.abort();
            reject(new PipelineTimeoutError(label, ms));
        }, ms);
    });
    try {
        return await Promise.race([factory(controller.signal), timeout]);
    } finally {
        clearTimeout(timer);
        controller.abort();
    }
}

async function assertSenderDomainDnsValid(
    senderDomainId: string,
    triggeredBy: string,
): Promise<void> {
    const { spfValid, dkimValid, dmarcValid, dnsCheckedAt } = await verifySenderDomainDns(
        senderDomainId,
        triggeredBy,
    );

    if (!spfValid || !dkimValid || !dmarcValid) {
        logger.warn(
            { senderDomainId, spfValid, dkimValid, dmarcValid, dnsCheckedAt },
            "[orchestrator] Sender domain failed DNS validation — blocking campaign launch",
        );

        throw new SenderDnsError(
            senderDomainId,
            `SPF valid: ${spfValid}, DKIM valid: ${dkimValid}, DMARC valid: ${dmarcValid}. ` +
            "Fix the domain's DNS records and re-verify before launching this campaign.",
        );
    }

    logger.info(
        { senderDomainId, spfValid, dkimValid, dmarcValid, dnsCheckedAt },
        "[orchestrator] Sender domain DNS validation passed",
    );
}

async function assertMailboxDnsValid(
    senderMailboxId: string,
    triggeredBy: string,
): Promise<void> {
    const { sendingDomain, spfValid, dkimValid, dmarcValid, dnsCheckedAt } = await verifyMailboxDns(
        senderMailboxId,
        triggeredBy,
    );

    if (!spfValid || !dkimValid || !dmarcValid) {
        logger.warn(
            { senderMailboxId, sendingDomain, spfValid, dkimValid, dmarcValid, dnsCheckedAt },
            "[orchestrator] Sender mailbox DNS validation failed — blocking campaign launch",
        );

        throw new SenderDnsError(
            senderMailboxId,
            `Mailbox domain ${sendingDomain} — SPF valid: ${spfValid}, DKIM valid: ${dkimValid}, DMARC valid: ${dmarcValid}. ` +
            "Fix the mailbox sending domain's DNS records and re-verify before launching this campaign.",
        );
    }

    logger.info(
        { senderMailboxId, sendingDomain, spfValid, dkimValid, dmarcValid, dnsCheckedAt },
        "[orchestrator] Sender mailbox DNS validation passed",
    );
}

function classifyCampaignError(err: unknown): { code: string; message: string } {
    const rawMessage = err instanceof Error ? err.message : String(err);
    const normalized = rawMessage.toLowerCase();

    let code = "UNKNOWN_ERROR";
    let message = rawMessage;

    if (normalized.includes("dns") || normalized.includes("spf") || normalized.includes("dkim") || normalized.includes("dmarc")) {
        code = "DNS_RECORD_MISSING";
        message = `DNS Verification Failed: Your sending domain is missing valid SPF, DKIM, or DMARC records. Please update your domain DNS settings.`;
    } else if (normalized.includes("mailbox connection") || normalized.includes("mailbox authentication") || normalized.includes("invalid_grant") || normalized.includes("sender mailbox")) {
        code = "CREDENTIALS_EXPIRED";
        message = `Mailbox Connection Failed: The OAuth token or credentials for your sending mailbox have expired. Please re-authenticate your mailbox in settings.`;
    } else if (normalized.includes("linkedin") || normalized.includes("unipile")) {
        code = "LINKEDIN_AUTH_FAILED";
        message = `LinkedIn Authentication Failed: Your LinkedIn session has expired or is not authenticated. Please log back into your LinkedIn account in settings.`;
    } else if (normalized.includes("quota") || normalized.includes("rate limit") || normalized.includes("resource exhausted") || normalized.includes("429") || normalized.includes("limit exceeded")) {
        code = "API_LIMIT_REACHED";
        message = `API Rate Limit Exceeded: The AI agent or third-party discovery provider hit an API rate limit. The system will automatically retry shortly.`;
    } else if (normalized.includes("no sender") || normalized.includes("nosender") || normalized.includes("no mailbox or linkedin")) {
        code = "NO_SENDER_CONFIGURED";
        message = `No Sender Configured: Please assign a sender domain and a sender mailbox to your campaign before launching.`;
    } else if (normalized.includes("compliance") || normalized.includes("spam risk") || normalized.includes("blocked")) {
        code = "COMPLIANCE_BLOCKED";
        message = `Compliance Blocked: The generated email copy triggered compliance rules or has a high spam risk score. Please refine your campaign instructions.`;
    }

    return { code, message };
}

async function lockCampaign(
    campaignId: string,
    triggeredBy: string,
): Promise<string> {
    const lockKey = `lock:campaign-launch:${campaignId}`;
    const acquired = await redis.set(lockKey, "1", "PX", 10_000, "NX");
    if (!acquired) {
        throw new Error("A campaign launch operation is already in progress for this campaign. Please try again shortly.");
    }

    try {
        let jobId = "";

        await prisma.$transaction(async (tx) => {
            const updated = await tx.campaign.updateMany({
                where: {
                    id: campaignId,
                    createdById: triggeredBy,
                    status: { in: ["DRAFT", "FAILED", "RESEARCHING"] },
                },
                data: { status: "RESEARCHING", regenAttempts: 0 },
            });

            if (updated.count === 0) {
                const existing = await tx.campaign.findUnique({
                    where: { id: campaignId },
                    select: { createdById: true, status: true },
                });

                if (!existing) throw new CampaignNotFoundError(campaignId);
                if (existing.createdById !== triggeredBy) throw new CampaignOwnershipError(campaignId);
                if (existing.status === "COMPLETED") throw new CampaignAlreadyCompletedError(campaignId);
                if (ACTIVE_STATUSES.has(existing.status) || existing.status === "PAUSED") {
                    throw new CampaignAlreadyRunningError(campaignId, existing.status);
                }
                throw new CampaignInvalidStateError(
                    campaignId,
                    existing.status,
                    "cannot launch campaign from this state",
                );
            }

            await tx.queueJob.updateMany({
                where: {
                    campaignId,
                    status: "ACTIVE",
                    jobType: { in: ["FULL_PIPELINE", "RESUME_SEND"] },
                },
                data: { status: "FAILED", errorMessage: "Superseded by stall-recovery restart" },
            });

            const job = await tx.queueJob.create({
                data: {
                    campaignId,
                    queueName: "campaign-orchestration",
                    jobType: "FULL_PIPELINE",
                    status: "ACTIVE",
                    payload: {
                        triggeredBy,
                        startedAt: new Date().toISOString(),
                    },
                },
            });

            jobId = job.id;
        });

        return jobId;
    } finally {
        await redis.del(lockKey).catch(() => null);
    }
}

async function lockResume(campaignId: string, triggeredBy: string): Promise<ResumePoint> {
    const lockKey = `lock:campaign-resume:${campaignId}`;
    const acquired = await redis.set(lockKey, "1", "PX", 10_000, "NX");
    if (!acquired) {
        throw new Error("A campaign resume operation is already in progress for this campaign. Please try again shortly.");
    }

    try {
        let resumeFrom: ResumePoint = "QUEUED";

        await prisma.$transaction(async (tx) => {
            const campaign = await tx.campaign.findUnique({
                where: { id: campaignId },
                select: { status: true, previousStatus: true, createdById: true },
            });

            if (!campaign) throw new CampaignNotFoundError(campaignId);

            if (campaign.createdById !== triggeredBy) {
                throw new CampaignOwnershipError(campaignId);
            }

            if (campaign.status !== "PAUSED") {
                throw new CampaignInvalidStateError(
                    campaignId,
                    campaign.status,
                    "campaign must be PAUSED to resume",
                );
            }

            if (!campaign.previousStatus) {
                throw new CampaignResumeError(
                    campaignId,
                    "campaign has no previousStatus — cannot determine resume point",
                );
            }

            const checkpoint = await tx.campaignStateStore.findUnique({
                where: { campaignId },
                select: { currentNode: true },
            });

            const rawResumeFrom = checkpoint?.currentNode ?? campaign.previousStatus;

            if (!isResumePoint(rawResumeFrom)) {
                throw new CampaignResumeError(
                    campaignId,
                    `invalid resume point "${rawResumeFrom}" — cannot safely resume`,
                );
            }

            resumeFrom = rawResumeFrom;

            if (resumeFrom === "REVIEW") {
                const approvedCount = await tx.outreachMessage.count({
                    where: {
                        lead: { campaignId },
                        approvalStatus: "APPROVED",
                    },
                });

                if (approvedCount === 0) {
                    await tx.campaign.update({
                        where: { id: campaignId },
                        data: { status: "REVIEW", previousStatus: null },
                    });
                    throw new CampaignResumeError(
                        campaignId,
                        "no approved messages — campaign returned to REVIEW for human action",
                    );
                }
            }

            const updated = await tx.campaign.updateMany({
                where: { id: campaignId, status: "PAUSED" },
                data: { status: "QUEUED", previousStatus: null },
            });

            if (updated.count === 0) {
                throw new CampaignResumeError(campaignId, "campaign already resumed by another request");
            }
        });

        return resumeFrom;
    } finally {
        await redis.del(lockKey).catch(() => null);
    }
}

export async function runCampaign(
    campaignId: string,
    triggeredBy: string,
): Promise<void> {
    const jobId = await lockCampaign(campaignId, triggeredBy);

    const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { name: true, senderDomainId: true, senderMailboxId: true },
    });

    if (!campaign) throw new CampaignNotFoundError(campaignId);

    logger.info(
        { campaignId, triggeredBy },
        `[orchestrator] Starting campaign "${campaign.name}"`,
    );

    try {
        await prisma.campaignStateStore.deleteMany({ where: { campaignId } });

        if (campaign.senderDomainId) {
            await assertSenderDomainDnsValid(campaign.senderDomainId, triggeredBy);
        }

        if (campaign.senderMailboxId) {
            await assertMailboxDnsValid(campaign.senderMailboxId, triggeredBy);
            const mailboxCheck = await verifyMailboxConnection(campaign.senderMailboxId, triggeredBy).catch(() => ({ connected: false }));
            if (!mailboxCheck.connected) {
                throw new Error("Campaign sender mailbox connection failed. Please re-authenticate your mailbox before launching.");
            }
        }

        const linkedinHandle = await createLinkedInProvider(campaignId).catch(() => null);
        if (linkedinHandle) {
            const { provider, account } = linkedinHandle;
            const health = await provider.health(account).catch((err) => ({ healthy: false, authenticated: false, error: err.message }));
            if (!health.healthy || !health.authenticated) {
                throw new Error(`Campaign LinkedIn connection failed: ${health.error ?? "not authenticated"}. Please check your LinkedIn account settings before launching.`);
            }
        }

        const reviewSummary = await withTimeout(
            (signal) => runGraphPipeline(campaignId, { signal }),
            PIPELINE_TIMEOUT_MS,
            `runGraphPipeline(${campaignId})`,
        );

        if (!isValidReviewSummary(reviewSummary)) {
            throw new InvalidReviewSummaryError(campaignId);
        }

        const finalStatus = await prisma.$transaction(async (tx) => {
            const finalCampaign = await tx.campaign.findUnique({
                where: { id: campaignId },
                select: { status: true },
            });

            if (!finalCampaign) throw new CampaignNotFoundError(campaignId);

            await tx.queueJob.update({
                where: { id: jobId },
                data: {
                    status: "COMPLETED",
                    result: reviewSummary as unknown as Prisma.InputJsonValue,
                },
            });

            await tx.campaignStateStore.deleteMany({ where: { campaignId } });

            return finalCampaign.status;
        });

        logger.info(
            { campaignId, finalStatus },
            "[orchestrator] Campaign finished",
        );
    } catch (err) {
        if (err instanceof CampaignPausedError) {
            await prisma.queueJob.update({
                where: { id: jobId },
                data: { status: "PAUSED" },
            });
            logger.info({ campaignId }, "[orchestrator] Campaign paused between stages");
            return;
        }

        if (err instanceof CampaignPipelineBusyError) {
            await prisma.queueJob.update({
                where: { id: jobId },
                data: { status: "PAUSED" },
            });
            logger.warn({ campaignId }, "[orchestrator] Campaign pipeline lock already held — job deferred");
            return;
        }

        if (err instanceof NoSenderError) {
            const { code, message } = classifyCampaignError(err);
            const errorMessage = `[${code}] ${message}`;
            await prisma.$transaction([
                prisma.campaign.updateMany({
                    where: {
                        id: campaignId,
                        status: { notIn: ["PAUSED", "COMPLETED"] },
                    },
                    data: { status: "FAILED" },
                }),
                prisma.queueJob.update({
                    where: { id: jobId },
                    data: { status: "FAILED", errorMessage },
                }),
            ]);
            logger.warn({ campaignId }, "[orchestrator] Campaign has no sender — marked failed");
            return;
        }

        const { code, message } = classifyCampaignError(err);
        const errorMessage = `[${code}] ${message}`;
        const errorStack = err instanceof Error ? err.stack : undefined;

        const checkpoint = await prisma.campaignStateStore.findUnique({
            where: { campaignId },
            select: { currentNode: true },
        }).catch(() => null);

        await prisma.$transaction([
            prisma.campaign.updateMany({
                where: {
                    id: campaignId,
                    status: { notIn: ["PAUSED", "COMPLETED"] },
                },
                data: { status: "FAILED" },
            }),
            prisma.queueJob.update({
                where: { id: jobId },
                data: {
                    status: "FAILED",
                    errorMessage,
                    result: {
                        errorClass: code,
                        errorStack: errorStack ?? null,
                        checkpointNode: checkpoint?.currentNode ?? null,
                    } as unknown as Prisma.InputJsonValue,
                },
            }),
        ]);

        logger.error(
            { campaignId, checkpointNode: checkpoint?.currentNode ?? null, err },
            "[orchestrator] Campaign failed",
        );
        throw err;
    }
}

export async function pauseCampaign(campaignId: string): Promise<void> {
    const lockKey = `lock:campaign-pause:${campaignId}`;
    const acquired = await redis.set(lockKey, "1", "PX", 10_000, "NX");
    if (!acquired) {
        throw new Error("A campaign pause operation is already in progress for this campaign. Please try again shortly.");
    }

    try {
        await prisma.$transaction(async (tx) => {
            const campaign = await tx.campaign.findUnique({
                where: { id: campaignId },
                select: { status: true },
            });

            if (!campaign) throw new CampaignNotFoundError(campaignId);

            if (!PAUSABLE_STATUSES.has(campaign.status)) {
                throw new CampaignInvalidStateError(
                    campaignId,
                    campaign.status,
                    "cannot pause from this status",
                );
            }

            const updated = await tx.campaign.updateMany({
                where: { id: campaignId, status: campaign.status },
                data: {
                    previousStatus: campaign.status,
                    status: "PAUSED",
                },
            });

            if (updated.count === 0) {
                throw new Error("Campaign status changed during pausing process");
            }

            await tx.queueJob.updateMany({
                where: { campaignId, status: "ACTIVE" },
                data: { status: "PAUSED" },
            });
        });
    } finally {
        await redis.del(lockKey).catch(() => null);
    }
}

export async function resumeCampaign(
    campaignId: string,
    triggeredBy: string,
): Promise<void> {
    const resumeFrom = await lockResume(campaignId, triggeredBy);

    const job = await prisma.queueJob.create({
        data: {
            campaignId,
            queueName: "campaign-orchestration",
            jobType: "RESUME_PIPELINE",
            status: "ACTIVE",
            payload: {
                triggeredBy,
                resumedFrom: resumeFrom,
                startedAt: new Date().toISOString(),
            },
        },
    });

    try {
        const campaignForChecks = await prisma.campaign.findUnique({
            where: { id: campaignId },
            select: { senderDomainId: true, senderMailboxId: true },
        });

        if (!campaignForChecks) throw new CampaignNotFoundError(campaignId);

        if (campaignForChecks.senderDomainId) {
            await assertSenderDomainDnsValid(campaignForChecks.senderDomainId, triggeredBy);
        }

        if (campaignForChecks.senderMailboxId) {
            await assertMailboxDnsValid(campaignForChecks.senderMailboxId, triggeredBy);
            const mailboxCheck = await verifyMailboxConnection(campaignForChecks.senderMailboxId, triggeredBy).catch(() => ({ connected: false }));
            if (!mailboxCheck.connected) {
                throw new Error("Campaign sender mailbox connection failed. Please re-authenticate your mailbox before resuming.");
            }
        }

        const linkedinHandle = await createLinkedInProvider(campaignId).catch(() => null);
        if (linkedinHandle) {
            const { provider, account } = linkedinHandle;
            const health = await provider.health(account).catch((err) => ({ healthy: false, authenticated: false, error: err.message }));
            if (!health.healthy || !health.authenticated) {
                throw new Error(`Campaign LinkedIn connection failed: ${health.error ?? "not authenticated"}. Please check your LinkedIn account settings before resuming.`);
            }
        }

        logger.info(
            { campaignId, triggeredBy, resumeFrom },
            "[orchestrator] Resuming campaign",
        );

        const reviewSummary = await withTimeout(
            (signal) => runGraphPipeline(campaignId, { resumeFrom, signal }),
            PIPELINE_TIMEOUT_MS,
            `runGraphPipeline(${campaignId}, resumeFrom=${resumeFrom})`,
        );

        if (!isValidReviewSummary(reviewSummary)) {
            throw new InvalidReviewSummaryError(campaignId);
        }

        await prisma.$transaction(async (tx) => {
            const finalCampaign = await tx.campaign.findUnique({
                where: { id: campaignId },
                select: { status: true },
            });

            if (!finalCampaign) throw new CampaignNotFoundError(campaignId);

            await tx.queueJob.update({
                where: { id: job.id },
                data: {
                    status: "COMPLETED",
                    result: reviewSummary as unknown as Prisma.InputJsonValue,
                },
            });

            await tx.campaignStateStore.deleteMany({ where: { campaignId } });
        });

        logger.info({ campaignId }, "[orchestrator] Campaign resumed and completed");
    } catch (err) {
        if (err instanceof CampaignPausedError) {
            await prisma.queueJob.update({
                where: { id: job.id },
                data: { status: "PAUSED" },
            });
            logger.info({ campaignId }, "[orchestrator] Campaign re-paused during resume");
            return;
        }

        if (err instanceof CampaignPipelineBusyError) {
            await prisma.queueJob.update({
                where: { id: job.id },
                data: { status: "PAUSED" },
            });
            logger.warn({ campaignId }, "[orchestrator] Resume pipeline lock already held — job deferred");
            return;
        }

        if (err instanceof NoSenderError) {
            const { code, message } = classifyCampaignError(err);
            const errorMessage = `[${code}] ${message}`;
            await prisma.$transaction([
                prisma.campaign.updateMany({
                    where: { id: campaignId, status: { notIn: ["PAUSED", "COMPLETED"] } },
                    data: { status: "FAILED" },
                }),
                prisma.queueJob.update({
                    where: { id: job.id },
                    data: { status: "FAILED", errorMessage },
                }),
            ]);
            logger.warn({ campaignId }, "[orchestrator] Resume has no sender — marked failed");
            return;
        }

        const { code, message } = classifyCampaignError(err);
        const errorMessage = `[${code}] ${message}`;
        const errorStack = err instanceof Error ? err.stack : undefined;

        const checkpoint = await prisma.campaignStateStore.findUnique({
            where: { campaignId },
            select: { currentNode: true },
        }).catch(() => null);

        await prisma.$transaction([
            prisma.campaign.updateMany({
                where: { id: campaignId, status: { notIn: ["PAUSED", "COMPLETED"] } },
                data: { status: "FAILED" },
            }),
            prisma.queueJob.update({
                where: { id: job.id },
                data: {
                    status: "FAILED",
                    errorMessage,
                    result: {
                        errorClass: code,
                        errorStack: errorStack ?? null,
                        checkpointNode: checkpoint?.currentNode ?? null,
                    } as unknown as Prisma.InputJsonValue,
                },
            }),
        ]);

        logger.error({ campaignId, err }, "[orchestrator] Resume failed");
        throw err;
    }
}