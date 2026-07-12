import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../auth/auth.types";
import * as AITraceService from "./Aitrace.service";
import { getAITracesQuerySchema } from "./aitrace.schema";

export async function getAITraces(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const query = getAITracesQuerySchema.parse(req.query);
        const result = await AITraceService.getAITraces(query);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
}

export async function getAITraceStats(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const stats = await AITraceService.getAITraceStats();
        res.status(200).json(stats);
    } catch (error) {
        next(error);
    }
}

export async function getAITraceById(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { id } = req.params as { id: string };
        const trace = await AITraceService.getAITraceById(id);
        if (!trace) {
            res.status(404).json({ error: "AI trace not found" });
            return;
        }
        res.status(200).json(trace);
    } catch (error) {
        next(error);
    }
}

export async function deleteAITrace(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { id } = req.params as { id: string };
        await AITraceService.deleteAITrace(id);
        res.status(204).send();
    } catch (error) {
        next(error);
    }
}