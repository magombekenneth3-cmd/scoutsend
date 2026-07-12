import { Router } from "express";
import { authMiddleware } from "../auth/auth.middleware";
import { requireAdmin } from "../auth/auth.rbac";
import {
  getAITraces,
  getAITraceById,
  getAITraceStats,
  deleteAITrace,
} from "./aitrace.controller";

const router = Router();

router.use(authMiddleware);
router.use(requireAdmin);

router.get("/stats", getAITraceStats);
router.get("/", getAITraces);
router.get("/:id", getAITraceById);
router.delete("/:id", deleteAITrace);

export default router;