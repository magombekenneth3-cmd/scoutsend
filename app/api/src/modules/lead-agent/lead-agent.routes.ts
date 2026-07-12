import { Router } from "express";
import rateLimit from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import { authMiddleware } from "../auth/auth.middleware";
import { redis } from "../../lib/ioredis";
import {
    createColumn,
    listColumns,
    triggerRun,
    triggerBatch,
    streamRun,
} from "./lead-agent.controller";

function makeRedisStore() {
    return new RedisStore({
        sendCommand: (...args: string[]) => (redis.call as any)(...args) as any,
    });
}

const leadAgentRunLimiter = rateLimit({
    windowMs: 60_000,
    max: 20,
    message: { error: "Too many agent run requests, please try again later" },
    standardHeaders: true,
    legacyHeaders: false,
    store: makeRedisStore(),
});

const router = Router();

router.use(authMiddleware);

router.get("/campaigns/:campaignId/agent-columns", listColumns);
router.post("/campaigns/:campaignId/agent-columns", createColumn);
router.post("/campaigns/:campaignId/agent-runs/batch", triggerBatch);
router.post("/leads/:leadId/agent-runs", leadAgentRunLimiter, triggerRun);
router.get("/agent-runs/:runId/stream", streamRun);

export default router;