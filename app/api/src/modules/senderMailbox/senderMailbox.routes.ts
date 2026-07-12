import { Router } from "express";
import { authMiddleware } from "../auth/auth.middleware";
import {
    createSenderMailbox,
    getSenderMailboxes,
    getSenderMailboxById,
    updateSenderMailbox,
    deleteSenderMailbox,
    verifyMailboxConnection,
    verifyMailboxDns,
    resetMailboxDailyCount,
} from "./senderMailbox.controller";
import {
    getCalendlyAuthUrl,
    disconnectCalendly,
} from "../calendar/calendar.controller";

const router = Router();

router.use(authMiddleware);

router.post("/", createSenderMailbox);
router.get("/", getSenderMailboxes);
router.get("/:id", getSenderMailboxById);
router.patch("/:id", updateSenderMailbox);
router.delete("/:id", deleteSenderMailbox);
router.post("/:id/verify", verifyMailboxConnection);
router.post("/:id/verify-dns", verifyMailboxDns);
router.post("/:id/reset-daily-count", resetMailboxDailyCount);
router.get("/:id/calendly/connect", getCalendlyAuthUrl);
router.delete("/:id/calendly", disconnectCalendly);

export default router;