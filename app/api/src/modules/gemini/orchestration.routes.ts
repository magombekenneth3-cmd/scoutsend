import { Router } from "express";
import rateLimit from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import { authMiddleware } from "../auth/auth.middleware";
import { requireOperatorOrAbove } from "../auth/auth.rbac";
import { runLookalikeSearch } from "./orchestration.controller";
import {
    runCampaign,
    pauseCampaign,
    resumeCampaign,
    discoverLeads,
} from "./orchestration.controller";
import { redis } from "../../lib/ioredis";

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

router.post("/:id/run", requireOperatorOrAbove, aiLimiter, runCampaign);
router.post("/:id/pause", requireOperatorOrAbove, pauseCampaign);
router.post("/:id/resume", requireOperatorOrAbove, resumeCampaign);
router.post("/:id/lookalike", requireOperatorOrAbove, aiLimiter, runLookalikeSearch);
router.post("/:id/discover", requireOperatorOrAbove, aiLimiter, discoverLeads);

export default router;