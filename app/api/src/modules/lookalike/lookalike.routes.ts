import { Router, Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../auth/auth.types";
import { authMiddleware } from "../auth/auth.middleware";
import { requireOperatorOrAbove } from "../auth/auth.rbac";
import rateLimit from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import { redis } from "../../lib/ioredis";
import { queueLookalikeSearch } from "./lookalike.service";

const aiLimiter = rateLimit({
    windowMs: 60_000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({
        sendCommand: (...args: string[]) => (redis.call as any)(...args) as any,
    }),
});

const router = Router();

router.use(authMiddleware);

router.post("/:id/lookalike", requireOperatorOrAbove, aiLimiter, async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
): Promise<void> => {
    try {
        if (!req.user) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }

        const { id } = req.params as { id: string };
        const { clientUrls } = req.body as { clientUrls?: unknown };

        await queueLookalikeSearch({
            campaignId: id,
            userId: req.user.userId,
            clientUrls,
        });

        res.status(202).json({ message: "Lookalike search queued", campaignId: id });
    } catch (error) {
        if (error && typeof error === "object" && "statusCode" in error) {
            const err = error as { statusCode: number; message: string };
            res.status(err.statusCode).json({ error: err.message });
            return;
        }
        next(error);
    }
});

export default router;