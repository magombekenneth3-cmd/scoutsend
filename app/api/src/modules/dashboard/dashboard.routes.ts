import { Router } from "express";
import { authMiddleware } from "../auth/auth.middleware";
import { AuthenticatedRequest } from "../auth/auth.types";
import { Response, NextFunction } from "express";
import { z } from "zod";
import { getDashboardStats, getDashboardPipelineChart } from "./dashboard.service";
import { redis } from "../../lib/ioredis";

async function cachedJson<T>(key: string, ttlSeconds: number, fetcher: () => Promise<T>): Promise<T> {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached) as T;
    const data = await fetcher();
    await redis.set(key, JSON.stringify(data), "EX", ttlSeconds);
    return data;
}

const router = Router();

router.use(authMiddleware);

router.get("/stats", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const stats = await cachedJson(
            `cache:dashboard-stats:${req.user!.userId}`,
            60,
            () => getDashboardStats(req.user!.userId)
        );
        res.json(stats);
    } catch (error) {
        next(error);
    }
});

const pipelineChartQuerySchema = z.object({
    days: z.coerce.number().int().min(1).max(365).default(7),
    campaignId: z.string().min(1).optional(),
});

router.get("/pipeline-chart", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const { days, campaignId } = pipelineChartQuerySchema.parse(req.query);
        const cacheKey = campaignId
            ? `cache:dashboard-chart:${req.user!.userId}:${campaignId}:${days}`
            : `cache:dashboard-chart:${req.user!.userId}:all:${days}`;
        const data = await cachedJson(
            cacheKey,
            120,
            () => getDashboardPipelineChart(req.user!.userId, days, campaignId)
        );
        res.json({ data });
    } catch (error) {
        next(error);
    }
});

export default router;