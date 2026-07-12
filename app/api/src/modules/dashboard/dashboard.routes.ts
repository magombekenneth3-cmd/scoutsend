import { Router } from "express";
import { authMiddleware } from "../auth/auth.middleware";
import { AuthenticatedRequest } from "../auth/auth.types";
import { Response, NextFunction } from "express";
import { z } from "zod";
import { getDashboardStats, getDashboardPipelineChart } from "./dashboard.service";

const router = Router();

router.use(authMiddleware);

router.get("/stats", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const stats = await getDashboardStats(req.user!.userId);
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
        const data = await getDashboardPipelineChart(req.user!.userId, days, campaignId);
        res.json({ data });
    } catch (error) {
        next(error);
    }
});

export default router;