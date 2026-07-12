import { Router } from "express";
import { authMiddleware } from "../auth/auth.middleware";
import {
  createSenderDomain,
  getSenderDomains,
  getSenderDomainById,
  updateSenderDomain,
  deleteSenderDomain,
  resetDailyCount,
  verifySenderDomainDns,
} from "./senderDomian.controller";

const router = Router();

router.use(authMiddleware);

router.post("/", createSenderDomain);
router.get("/", getSenderDomains);
router.get("/:id", getSenderDomainById);
router.patch("/:id", updateSenderDomain);
router.delete("/:id", deleteSenderDomain);
router.post("/:id/reset-daily-count", resetDailyCount);
router.post("/:id/verify", verifySenderDomainDns);

export default router;