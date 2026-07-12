import { Router } from "express";
import { authMiddleware } from "../auth/auth.middleware";
import {
  getQueueJobs,
  getQueueJobById,
  getQueueStats,
  retryQueueJob,
} from "./queue.controller";

const router = Router();

router.use(authMiddleware);

router.get("/stats", getQueueStats);
router.get("/", getQueueJobs);
router.get("/:id", getQueueJobById);
router.post("/:id/retry", retryQueueJob);

export default router;