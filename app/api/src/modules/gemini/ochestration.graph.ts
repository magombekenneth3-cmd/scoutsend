import { prisma } from "../../lib/prisma";
import { runIcpRefinementAgent, RefinedICP } from "./icp.refinementAgent";
import { runResearchAgent } from "./gemini.agent";
import { runGenerateAgent } from "./generate.agent";
import { runReviewAgent, ReviewSummary, RejectionReason } from "./review.agent";
import { runSendAgent } from "./send.agent";
import { logger } from "../../lib/logger";
import { redis } from "../../lib/ioredis";
import type { ResumePoint } from "./orchestration.types";

const NODE_TIMEOUT_MS = 25 * 60_000;
const PIPELINE_LOCK_TTL_MS = 15 * 60_000;
const PIPELINE_LOCK_HEARTBEAT_MS = 5 * 60_000;

async function withTimeout<T>(
    factory: () => Promise<T>,
    ms: number,
    signal?: AbortSignal,
): Promise<T> {
    if (signal?.aborted) throw new Error("Pipeline aborted");

    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortHandler: (() => void) | undefined;

    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Agent timed out after ${ms}ms`)), ms);
        if (signal) {
            abortHandler = () => {
                clearTimeout(timer);
                reject(new Error("Pipeline aborted"));
            };
            signal.addEventListener("abort", abortHandler, { once: true });
        }
    });

    try {
        return await Promise.race([factory(), timeout]);
    } finally {
        clearTimeout(timer);
        if (signal && abortHandler) {
            signal.removeEventListener("abort", abortHandler);
        }
    }
}

async function finalizeGenerationFailures(campaignId: string): Promise<number> {
    const { count } = await prisma.outreachMessage.updateMany({
        where: {
            lead: { campaignId },
            approvalStatus: "PENDING",
            deliveryState: "DRAFT",
            OR: [{ spamRiskScore: null }, { personalizationScore: null }],
        },
        data: { deliveryState: "FAILED" },
    });
    return count;
}

async function saveGraphCheckpoint(
    campaignId: string,
    currentNode: string,
    regenAttemptsCount: number,
): Promise<void> {
    await prisma.campaignStateStore.upsert({
        where: { campaignId },
        create: { campaignId, currentNode, regenAttemptsCount, approvalStatuses: {} },
        update: { currentNode, regenAttemptsCount },
    });
}

const MAX_REGEN_ATTEMPTS = 2;

const emptyReviewSummary: ReviewSummary = {
    total: 0,
    autoApproved: 0,
    sentToQualityAgent: 0,
    heldForReview: 0,
    generationFailed: 0,
    evalTimedOut: 0,
    complianceBlocked: 0,
    rejectionMap: {},
};

export interface CampaignState {
    campaignId: string;
    icpDescription: string | null;
    reviewSummary: ReviewSummary | null;
    feedbackMap: Record<string, RejectionReason>;
    regenCount: number;
}

function initialState(campaignId: string): CampaignState {
    return {
        campaignId,
        icpDescription: null,
        reviewSummary: null,
        feedbackMap: {},
        regenCount: 0,
    };
}

export type NodeFunction = (
    state: CampaignState,
) => Promise<Partial<CampaignState>>;

function applyPatch(
    state: CampaignState,
    patch: Partial<CampaignState>,
): CampaignState {
    return { ...state, ...patch };
}

export class NoSenderError extends Error {
    constructor(campaignId: string) {
        super(`Campaign ${campaignId} has no mailbox or LinkedIn account configured`);
        this.name = "NoSenderError";
    }
}

export class CampaignPausedError extends Error {
    constructor(campaignId: string) {
        super(`Campaign ${campaignId} was paused`);
        this.name = "CampaignPausedError";
    }
}

export class CampaignPipelineBusyError extends Error {
    constructor(campaignId: string) {
        super(`Campaign ${campaignId} pipeline already running — concurrent execution prevented`);
        this.name = "CampaignPipelineBusyError";
    }
}

export async function assertPauseGuard(campaignId: string): Promise<void> {
    const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { status: true },
    });
    if (campaign?.status === "PAUSED") {
        throw new CampaignPausedError(campaignId);
    }
}

export const icpRefinerNode: NodeFunction = async (state) => {
    logger.info({ campaignId: state.campaignId }, "[graph] icpRefinerNode start");

    const result: RefinedICP = await runIcpRefinementAgent(state.campaignId);

    logger.info(
        { campaignId: state.campaignId, notes: result.refinementNotes },
        "[graph] icpRefinerNode complete",
    );

    return { icpDescription: result.icpDescription };
};

export const researcherNode: NodeFunction = async (state) => {
    logger.info({ campaignId: state.campaignId }, "[graph] researcherNode start");

    await runResearchAgent(state.campaignId);

    logger.info({ campaignId: state.campaignId }, "[graph] researcherNode complete");

    return {};
};

export const generatorNode: NodeFunction = async (state) => {
    const isRegen = Object.keys(state.feedbackMap).length > 0;

    logger.info(
        {
            campaignId: state.campaignId,
            regenCount: state.regenCount,
            isRegen,
            rejectionCount: Object.keys(state.feedbackMap).length,
        },
        "[graph] generatorNode start",
    );

    await runGenerateAgent(state.campaignId, {
        feedbackMap: isRegen ? state.feedbackMap : undefined,
    });

    logger.info({ campaignId: state.campaignId }, "[graph] generatorNode complete");

    return {};
};

export const reviewerNode: NodeFunction = async (state) => {
    logger.info(
        { campaignId: state.campaignId, regenCount: state.regenCount },
        "[graph] reviewerNode start",
    );

    const summary: ReviewSummary = await runReviewAgent(state.campaignId);

    logger.info(
        {
            campaignId: state.campaignId,
            total: summary.total,
            autoApproved: summary.autoApproved,
            heldForReview: summary.heldForReview,
        },
        "[graph] reviewerNode complete",
    );

    return {
        reviewSummary: summary,
        feedbackMap: summary.rejectionMap,
        regenCount: state.regenCount + 1,
    };
};

export const senderNode: NodeFunction = async (state) => {
    logger.info({ campaignId: state.campaignId }, "[graph] senderNode start");

    await runSendAgent(state.campaignId);

    logger.info({ campaignId: state.campaignId }, "[graph] senderNode complete");

    return {};
};

export function shouldRegen(
    state: CampaignState,
): "generator" | "postReview" {
    const summary = state.reviewSummary;
    if (
        summary !== null &&
        state.regenCount <= MAX_REGEN_ATTEMPTS &&
        (summary.heldForReview > 0 || summary.generationFailed > 0) &&
        Object.keys(summary.rejectionMap).length > 0
    ) {
        logger.info(
            {
                campaignId: state.campaignId,
                regenCount: state.regenCount,
                maxAttempts: MAX_REGEN_ATTEMPTS,
                heldForReview: summary.heldForReview,
                rejections: Object.keys(summary.rejectionMap).length,
            },
            "[graph] shouldRegen → generator (quality gate failed, looping)",
        );
        return "generator";
    }

    logger.info(
        { campaignId: state.campaignId, regenCount: state.regenCount },
        "[graph] shouldRegen → postReview",
    );
    return "postReview";
}

export type PostReviewRoute =
    | "humanGate"
    | "noSender"
    | "linkedInOnly"
    | "send";

export async function postReviewRouter(
    state: CampaignState,
): Promise<PostReviewRoute> {
    const campaign = await prisma.campaign.findUnique({
        where: { id: state.campaignId },
        select: { status: true, senderMailboxId: true, linkedInAccountId: true },
    });

    if (campaign?.status === "REVIEW") {
        logger.info({ campaignId: state.campaignId }, "[graph] postReviewRouter → humanGate");
        return "humanGate";
    }

    if (!campaign?.senderMailboxId && !campaign?.linkedInAccountId) {
        logger.warn({ campaignId: state.campaignId }, "[graph] postReviewRouter → noSender");
        return "noSender";
    }

    if (!campaign?.senderMailboxId) {
        logger.info({ campaignId: state.campaignId }, "[graph] postReviewRouter → linkedInOnly");
        return "linkedInOnly";
    }

    logger.info({ campaignId: state.campaignId }, "[graph] postReviewRouter → send");
    return "send";
}

export interface PipelineOptions {
    resumeFrom?: ResumePoint;
    signal?: AbortSignal;
}

export async function runGraphPipeline(
    campaignId: string,
    opts: PipelineOptions = {},
): Promise<ReviewSummary> {
    const lockKey = `campaign-pipeline-lock:${campaignId}`;
    const acquired = await redis.set(lockKey, "1", "PX", PIPELINE_LOCK_TTL_MS, "NX");
    if (acquired !== "OK") {
        throw new CampaignPipelineBusyError(campaignId);
    }

    const heartbeat = setInterval(async () => {
        try {
            const refreshed = await redis.set(lockKey, "1", "PX", PIPELINE_LOCK_TTL_MS, "XX");
            if (refreshed !== "OK") {
                logger.warn({ campaignId }, "[graph] Pipeline lock evicted from Redis mid-run");
            }
        } catch (err) {
            logger.warn({ err, campaignId }, "[graph] Pipeline lock heartbeat error — Redis unreachable");
        }
    }, PIPELINE_LOCK_HEARTBEAT_MS);

    try {
        return await _runGraphPipeline(campaignId, opts);
    } finally {
        clearInterval(heartbeat);
        await redis.del(lockKey).catch(() => null);
    }
}

async function _runGraphPipeline(
    campaignId: string,
    opts: PipelineOptions = {},
): Promise<ReviewSummary> {
    const { resumeFrom, signal } = opts;

    const runIcpAndResearch = !resumeFrom || resumeFrom === "RESEARCHING";
    const runGenerateAndReview = runIcpAndResearch || resumeFrom === "GENERATING";

    let state = initialState(campaignId);

    if (!runGenerateAndReview) {
        state = applyPatch(state, { reviewSummary: emptyReviewSummary });
    }

    if (runIcpAndResearch) {
        state = applyPatch(state, await withTimeout(() => icpRefinerNode(state), NODE_TIMEOUT_MS, signal));
        await assertPauseGuard(campaignId);

        await saveGraphCheckpoint(campaignId, "RESEARCHING", 0);
        state = applyPatch(state, await withTimeout(() => researcherNode(state), NODE_TIMEOUT_MS, signal));
        await assertPauseGuard(campaignId);
    }

    if (runGenerateAndReview) {
        await saveGraphCheckpoint(campaignId, "GENERATING", state.regenCount);
        state = applyPatch(state, await withTimeout(() => generatorNode(state), NODE_TIMEOUT_MS, signal));
        await assertPauseGuard(campaignId);
        state = applyPatch(state, await withTimeout(() => reviewerNode(state), NODE_TIMEOUT_MS, signal));
        await assertPauseGuard(campaignId);

        while (shouldRegen(state) === "generator") {
            await prisma.campaign.update({
                where: { id: campaignId },
                data: { regenAttempts: { increment: 1 } },
            });
            await saveGraphCheckpoint(campaignId, "GENERATING", state.regenCount);
            state = applyPatch(state, await withTimeout(() => generatorNode(state), NODE_TIMEOUT_MS, signal));
            await assertPauseGuard(campaignId);
            state = applyPatch(state, await withTimeout(() => reviewerNode(state), NODE_TIMEOUT_MS, signal));
            await assertPauseGuard(campaignId);
        }
    }

    await saveGraphCheckpoint(campaignId, "SENDING", state.regenCount);
    const route = await postReviewRouter(state);

    if (route === "humanGate") {
        logger.info({ campaignId }, "[graph] Pipeline complete — awaiting human review");
        return state.reviewSummary!;
    }

    if (route === "noSender") {
        throw new NoSenderError(campaignId);
    }

    const abandoned = await finalizeGenerationFailures(campaignId);
    if (abandoned > 0) {
        logger.warn(
            { campaignId, abandoned },
            "[graph] Generation failures persist after max regen — messages marked FAILED",
        );
    }

    if (route === "linkedInOnly") {
        await prisma.campaign.update({
            where: { id: campaignId },
            data: { status: "QUEUED" },
        });
        logger.info({ campaignId }, "[graph] LinkedIn-only campaign queued for outreach scheduler");
        return state.reviewSummary!;
    }

    state = applyPatch(state, await withTimeout(() => senderNode(state), NODE_TIMEOUT_MS, signal));

    return state.reviewSummary!;
}