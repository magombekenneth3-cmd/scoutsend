import { Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { AuthenticatedRequest } from "../auth/auth.types";
import { prisma } from "../../lib/prisma";
import { campaignQueue, realtimeQueue } from "../gemini/campaign.queue";
import { assertCampaignOwner } from "../../lib/ownership";
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

// Fix #1: ZodError does not have `.errors` — it has `.issues`.
// Helper keeps the pattern DRY across all three safeParse call sites.
function zodMessage(err: ZodError): string {
    return err.issues.map((i) => i.message).join(", ");
}

export async function createColumn(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const { campaignId } = req.params as any;
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
        // Fix #2: req.params values are `string | string[]` in Express's types.
        // Destructure then assert as string — they are always strings for named
        // route params; the union only exists because Express types are loose.
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
        // Fix #2 (same pattern): cast named route params to string.
        const leadId = req.params.leadId as string;

        const parsed = triggerRunSchema.safeParse(req.body);
        if (!parsed.success) {
            // Fix #1: use .issues instead of .errors
            throw new ValidationError(zodMessage(parsed.error));
        }

        const { columnId } = parsed.data;

        // Fix #3: the Prisma select included `campaign` as a relation but Lead
        // only exposes `campaignId` as a scalar by default. Include the relation
        // explicitly so TypeScript knows it exists on the returned object.
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
                    // Fix #2: leadId is now typed as string, safe to pass directly.
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
            // Fix #1: use .issues instead of .errors
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
    // Fix #2: cast named route param to string.
    const runId = req.params.runId as string;

    // Fix #3 + Fix #4: include `lead` and `column` as explicit relation selects
    // so TypeScript knows they exist on the returned object. Without them Prisma
    // only returns scalar fields and the type has no `lead` or `column` property.
    const run = await prisma.leadAgentRun.findUnique({
        where: { id: runId },
        select: {
            id: true,
            status: true,
            result: true,
            errorMessage: true,
            completedAt: true,
            // Fix #4: `column` must be selected as a relation — accessing
            // `run.column` on a plain scalar select produces TS2551.
            column: { select: { fieldKey: true } },
            // Fix #3: same for `lead` — it is a relation, not a scalar.
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