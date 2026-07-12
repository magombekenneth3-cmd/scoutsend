import { Router } from "express";
import { authMiddleware } from "../auth/auth.middleware";
import {
  createOutreachMessage,
  getOutreachMessages,
  getChartStats,
  getOutreachMessageById,
  editOutreachMessage,
  approveOutreachMessage,
  rejectOutreachMessage,
  batchApproveMessages,
  batchRejectMessages,
  sendOutreachMessage,
} from "./message.controller";

const router = Router();

router.use(authMiddleware);

router.post("/", createOutreachMessage);
router.get("/", getOutreachMessages);
router.get("/chart-stats", getChartStats);
router.post("/batch-approve", batchApproveMessages);
router.post("/batch-reject", batchRejectMessages);
router.get("/:id", getOutreachMessageById);
router.patch("/:id", editOutreachMessage);
router.post("/:id/approve", approveOutreachMessage);
router.post("/:id/reject", rejectOutreachMessage);
router.post("/:id/send", sendOutreachMessage);

export default router;