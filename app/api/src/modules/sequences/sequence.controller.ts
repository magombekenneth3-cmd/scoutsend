import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { upsertSequenceSchema } from "./sequence.schema";
import { deleteCampaignSequence, getCampaignSequence, getSequenceLeadStatuses, getSequenceSummary, upsertCampaignSequence, validateSequenceSteps } from "./sequence.service";

export interface AuthenticatedRequest extends Request {
    userId: string;
}

const sequenceStatusQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    leadId: z.string().uuid().optional(),
});

const campaignIdSchema = z.string().uuid();

export async function requireCampaignOwner(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
) {
    const idResult = campaignIdSchema.safeParse(req.params.id);
    if (!idResult.success) {
        res.status(400).json({ error: "Invalid campaign id" });
        return;
    }
    const id = req.params.id as string;
    const campaign = await prisma.campaign.findFirst({
        where: { id, createdById: req.userId, deletedAt: null },
        select: { id: true },
    });
    if (!campaign) {
        res.status(404).json({ error: "Campaign not found" });
        return;
    }
    next();
}

export async function getSequence(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
) {
    const id = req.params.id as string;
    try {
        const steps = await getCampaignSequence(id);
        res.json({ steps });
    } catch (err) {
        next(err);
    }
}

export async function putSequence(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
) {
    const id = req.params.id as string;
    try {
        const parsed = upsertSequenceSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: parsed.error.flatten() });
            return;
        }
        const validationError = validateSequenceSteps(parsed.data.steps);
        if (validationError) {
            res.status(400).json({ error: validationError });
            return;
        }
        const steps = await upsertCampaignSequence(id, parsed.data.steps, new Date(parsed.data.expectedUpdatedAt));
        res.json({ steps });
    } catch (err) {
        next(err);
    }
}

export async function deleteSequence(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
) {
    const id = req.params.id as string;
    try {
        await deleteCampaignSequence(id);
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
}



export async function getSequenceStatus(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
) {
    const id = req.params.id as string;
    try {
        const queryResult = sequenceStatusQuerySchema.safeParse(req.query);
        if (!queryResult.success) {
            res.status(400).json({ error: queryResult.error.flatten() });
            return;
        }
        const statuses = await getSequenceLeadStatuses({
            campaignId: id,
            page: queryResult.data.page,
            pageSize: queryResult.data.pageSize,
            leadId: queryResult.data.leadId,
        });
        res.json({ statuses });
    } catch (err) {
        next(err);
    }
}

export async function getSequenceSummaryHandler(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
) {
    const id = req.params.id as string;
    try {
        const summary = await getSequenceSummary(id);
        res.json(summary);
    } catch (err) {
        next(err);
    }
}