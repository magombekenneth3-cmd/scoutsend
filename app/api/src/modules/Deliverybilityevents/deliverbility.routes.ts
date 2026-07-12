import { Router } from "express";
import { authMiddleware } from "../auth/auth.middleware";
import {
    ingestDeliverabilityEventHandler,
    getDeliverabilityEventsHandler,
    getDeliverabilityStatsHandler,
} from "./deliverbility.controller";

const router = Router();
router.post("/webhook", ingestDeliverabilityEventHandler);

router.use(authMiddleware);

router.get("/stats", getDeliverabilityStatsHandler);
router.get("/", getDeliverabilityEventsHandler);

export default router;