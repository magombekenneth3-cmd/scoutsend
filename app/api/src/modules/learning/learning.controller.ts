import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../auth/auth.types";
import * as LearningEventService from "./learning.service";
import {
    getLearningEventsQuerySchema,
    resolveLearningEventSchema,
    dismissLearningEventSchema,
} from "./learning.schema";
import { logAudit } from "../audit/audit.service";
import { AUDIT_EVENTS } from "../../lib/constants";

function getUserAgent(req: AuthenticatedRequest): string | undefined {
    const h = req.headers["user-agent"];
    return Array.isArray(h) ? h[0] : h;
}

export async function getLearningEvents(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const query = getLearningEventsQuerySchema.parse(req.query);
        const result = await LearningEventService.getLearningEvents(query);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
}

export async function getLearningEventStats(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const stats = await LearningEventService.getLearningEventStats();
        res.status(200).json(stats);
    } catch (error) {
        next(error);
    }
}

export async function getLearningEventById(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { id } = req.params as { id: string };
        const event = await LearningEventService.getLearningEventById(id);

        if (!event) {
            res.status(404).json({ error: "Learning event not found" });
            return;
        }

        res.status(200).json(event);
    } catch (error) {
        next(error);
    }
}

export async function resolveLearningEvent(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { id } = req.params as { id: string };
        const data = resolveLearningEventSchema.parse(req.body);
        const reviewerId = req.user!.userId;

        const result = await LearningEventService.resolveLearningEvent(
            id,
            data,
            reviewerId
        );

        await logAudit({
            userId: reviewerId,
            action: AUDIT_EVENTS.LEARNING_EVENT_RESOLVED,
            entityType: "LearningEvent",
            entityId: id,
            metadata: {
                outreachMessageId: result.learningEvent.outreachMessageId,
                outcome: result.learningEvent.outcome,
                wasEdited: !!(data.subject || data.body),
            },
            ipAddress: req.ip ?? undefined,
            userAgent: getUserAgent(req),
        });

        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
}

export async function dismissLearningEvent(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { id } = req.params as { id: string };
        const data = dismissLearningEventSchema.parse(req.body);
        const reviewerId = req.user!.userId;

        const result = await LearningEventService.dismissLearningEvent(
            id,
            data,
            reviewerId
        );

        await logAudit({
            userId: reviewerId,
            action: AUDIT_EVENTS.LEARNING_EVENT_DISMISSED,
            entityType: "LearningEvent",
            entityId: id,
            metadata: {
                outreachMessageId: result.learningEvent.outreachMessageId,
                reason: data.reason,
            },
            ipAddress: req.ip ?? undefined,
            userAgent: getUserAgent(req),
        });

        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
}