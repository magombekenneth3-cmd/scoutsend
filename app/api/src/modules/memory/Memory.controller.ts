import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../auth/auth.types";
import {
    getMemoryStats,
    getWinPatterns,
    getLossPatterns,
} from "./memory.service";

export async function getStats(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const stats = await getMemoryStats();
        res.json(stats);
    } catch (err) {
        next(err);
    }
}

export async function getWins(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { icpVertical, targetIndustry, targetRegion, limit } = req.query as Record<string, string>;
        const patterns = await getWinPatterns({
            icpVertical,
            targetIndustry,
            targetRegion,
            limit: limit ? Math.min(parseInt(limit, 10), 50) : 20,
        });
        res.json({ data: patterns, total: patterns.length });
    } catch (err) {
        next(err);
    }
}

export async function getLosses(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { icpVertical, targetIndustry, targetRegion, limit } = req.query as Record<string, string>;
        const patterns = await getLossPatterns({
            icpVertical,
            targetIndustry,
            targetRegion,
            limit: limit ? Math.min(parseInt(limit, 10), 50) : 20,
        });
        res.json({ data: patterns, total: patterns.length });
    } catch (err) {
        next(err);
    }
}