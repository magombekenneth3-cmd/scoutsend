import { Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { AuthenticatedRequest } from "../auth/auth.types";
import { prisma } from "../../lib/prisma";
import { campaignQueue, realtimeQueue } from "../gemini/campaign.queue";
import { assertCampaignOwner } from "../../lib/ownership";
import { isUUID } from "../campaigns/validate";
import { NotFoundError, ValidationError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import {
    runLeadAgent,
    subscribeLeadAgentListener,
    unsubscribeLeadAgentListener,
    LeadAgentStreamEvent,
} from "../gemini/lead-agent.agent";
import { createColumnSchema, triggerRunSchema, triggerBatchSchema } from "./lead-agent.schema";
import pLimit from "p-limit";

const BATCH_CONCURRENCY = 10;
function zodMessage(err: ZodError): string {
    return err.issues.map((i) => i.message).join(", ");
}

export async function createColumn(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const { campaignId } = req.params as { campaignId: string };
        if (!isUUID(campaignId)) throw new ValidationError("Invalid campaign ID");
        await assertCampaignOwner(campaignId, req.user!.userId);

        const parsed = createColumnSchema.safeParse(req.body);
        if (!parsed.success) {
            throw new ValidationError(zodMessage(parsed.error));
        }

        const { name, fieldKey, prompt, outputType } = parsed.data;

        try {
            const column = await prisma.leadAgentColumn.create({
                data: {
                    campaignId,
                    name,
                    fieldKey,
                    prompt,
                    outputType,
                    createdById: req.user!.userId,
                },
            });
            res.status(201).json({ column });
        } catch (err) {
            if (
                err instanceof Prisma.PrismaClientKnownRequestError &&
                err.code === "P2002"
            ) {
                res
                    .status(409)
                    .json({ error: `A column with fieldKey '${fieldKey}' already exists in this campaign` });
                return;
            }
            throw err;
        }
    } catch (err) {
        next(err);
    }
}

export async function listColumns(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const campaignId = req.params.campaignId as string;
        await assertCampaignOwner(campaignId, req.user!.userId);

        const columns = await prisma.leadAgentColumn.findMany({
            where: { campaignId, deletedAt: null },
            orderBy: { createdAt: "asc" },
        });

        res.json({ columns });
    } catch (err) {
        next(err);
    }
}

export async function triggerRun(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const leadId = req.params.leadId as string;

        const parsed = triggerRunSchema.safeParse(req.body);
        if (!parsed.success) {
            throw new ValidationError(zodMessage(parsed.error));
        }

        const { columnId } = parsed.data;
        const lead = await prisma.lead.findFirst({
            where: { id: leadId, deletedAt: null },
            select: {
                id: true,
                campaignId: true,
                campaign: { select: { createdById: true } },
            },
        });

        if (!lead) throw new NotFoundError("Lead");

        if (lead.campaign.createdById !== req.user!.userId) {
            res.status(403).json({ error: "Forbidden" });
            return;
        }

        const column = await prisma.leadAgentColumn.findFirst({
            where: { id: columnId, deletedAt: null, campaign: { createdById: req.user!.userId } },
            select: { id: true },
        });

        if (!column) throw new NotFoundError("Column");

        let run: { id: string };
        try {
            run = await prisma.leadAgentRun.create({
                data: {
                    leadId,
                    columnId,
                    status: "PENDING",
                    triggeredById: req.user!.userId,
                },
                select: { id: true },
            });
        } catch (err) {
            if (
                err instanceof Prisma.PrismaClientKnownRequestError &&
                err.code === "P2002"
            ) {
                const active = await prisma.leadAgentRun.findFirst({
                    where: { leadId, columnId, status: { in: ["PENDING", "RUNNING"] } },
                    select: { id: true, status: true },
                });
                res.status(200).json({ runId: active!.id, alreadyRunning: true });
                return;
            }
            throw err;
        }

        await realtimeQueue.add(
            "run-lead-agent",
            { runId: run.id },
            { jobId: `lead-agent-${run.id}` },
        );

        logger.info({ runId: run.id, leadId, columnId }, "[lead-agent] Run enqueued");
        res.status(201).json({ runId: run.id });
    } catch (err) {
        next(err);
    }
}

export async function triggerBatch(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        // Fix #2: cast named route param to string.
        const campaignId = req.params.campaignId as string;
        await assertCampaignOwner(campaignId, req.user!.userId);

        const parsed = triggerBatchSchema.safeParse(req.body);
        if (!parsed.success) {
            throw new ValidationError(zodMessage(parsed.error));
        }

        const { columnId } = parsed.data;

        const column = await prisma.leadAgentColumn.findFirst({
            where: { id: columnId, campaignId, deletedAt: null },
            select: { id: true },
        });

        if (!column) throw new NotFoundError("Column");

        const leads = await prisma.lead.findMany({
            where: { campaignId, deletedAt: null },
            select: { id: true },
        });

        let enqueued = 0;
        let skipped = 0;

        const limit = pLimit(BATCH_CONCURRENCY);

        await Promise.all(
            leads.map((lead) =>
                limit(async () => {
                    try {
                        const run = await prisma.leadAgentRun.create({
                            data: {
                                leadId: lead.id,
                                columnId,
                                status: "PENDING",
                                triggeredById: req.user!.userId,
                            },
                            select: { id: true },
                        });
                        await realtimeQueue.add(
                            "run-lead-agent",
                            { runId: run.id },
                            { jobId: `lead-agent-${run.id}` },
                        );
                        enqueued++;
                    } catch (err) {
                        if (
                            err instanceof Prisma.PrismaClientKnownRequestError &&
                            err.code === "P2002"
                        ) {
                            skipped++;
                            return;
                        }
                        throw err;
                    }
                }),
            ),
        );

        logger.info({ campaignId, columnId, enqueued, skipped }, "[lead-agent] Batch enqueued");
        res.json({ enqueued, skipped, total: leads.length });
    } catch (err) {
        next(err);
    }
}

export async function streamRun(
    req: AuthenticatedRequest,
    res: Response,
): Promise<void> {
    const runId = req.params.runId as string;
    const run = await prisma.leadAgentRun.findUnique({
        where: { id: runId },
        select: {
            id: true,
            status: true,
            result: true,
            errorMessage: true,
            completedAt: true,
            column: { select: { fieldKey: true } },
            lead: { select: { campaign: { select: { createdById: true } } } },
        },
    });

    if (!run) {
        res.status(404).json({ error: "Run not found" });
        return;
    }

    if (run.lead.campaign.createdById !== req.user!.userId) {
        res.status(403).json({ error: "Forbidden" });
        return;
    }

    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
    });

    function send(event: LeadAgentStreamEvent): void {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    if (run.status === "COMPLETE") {
        const value = (run.result as Record<string, unknown> | null)?.value ?? null;
        send({ type: "result", data: { fieldKey: run.column.fieldKey, value, runId: run.id } });
        send({
            type: "complete",
            data: { runId: run.id, completedAt: run.completedAt?.toISOString() ?? new Date().toISOString() },
        });
        res.end();
        return;
    }

    if (run.status === "FAILED" || run.status === "STALE") {
        send({ type: "error", data: { message: run.errorMessage ?? "Agent failed" } });
        send({ type: "status", data: { status: run.status } });
        res.end();
        return;
    }

    subscribeLeadAgentListener(run.id, send);

    const heartbeat = setInterval(() => {
        res.write(":\n\n");
    }, 25_000);

    req.on("close", () => {
        clearInterval(heartbeat);
        unsubscribeLeadAgentListener(run.id, send);
    });
}