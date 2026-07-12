import { Router } from "express";
import { authMiddleware } from "../auth/auth.middleware";

import {
    getLearningEvents,
    getLearningEventById,
    getLearningEventStats,
    resolveLearningEvent,
    dismissLearningEvent,
} from "./learning.controller";
import { requireAdmin, requireReviewerOrAdmin } from "../auth/auth.rbac";

const router = Router();

router.use(authMiddleware);

router.get("/stats", requireAdmin, getLearningEventStats);
router.get("/", requireReviewerOrAdmin, getLearningEvents);
router.get("/:id", requireReviewerOrAdmin, getLearningEventById);
router.post("/:id/resolve", requireReviewerOrAdmin, resolveLearningEvent);
router.post("/:id/dismiss", requireReviewerOrAdmin, dismissLearningEvent);

export default router;