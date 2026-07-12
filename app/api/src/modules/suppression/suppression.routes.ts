import { Router } from "express";
import { authMiddleware } from "../auth/auth.middleware";
import {
    createSuppression,
    createSuppressionBulk,
    getSuppressions,
    getSuppressionStats,
    checkSuppression,
    deleteSuppression,
} from "./suppression.controller";

const router = Router();

router.use(authMiddleware);

router.get("/stats", getSuppressionStats);
router.get("/check", checkSuppression);
router.get("/", getSuppressions);
router.post("/", createSuppression);
router.post("/bulk", createSuppressionBulk);
router.delete("/:id", deleteSuppression);

export default router;