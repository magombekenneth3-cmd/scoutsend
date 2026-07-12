import { Router } from "express";
import { authMiddleware } from "../auth/auth.middleware";
import {
    createReply,
    getReplies,
    getReplyById,
    updateReply,
    sendReplyDraft,
    markMeetingBooked,
    getPipelineStats,
} from "./replies.contoller";

const router = Router();

router.use(authMiddleware);

router.get("/pipeline/stats", getPipelineStats);

router.post("/", createReply);
router.get("/", getReplies);

router.get("/:id", getReplyById);
router.patch("/:id", updateReply);

router.post("/:id/send-draft", sendReplyDraft);
router.post("/:id/mark-meeting-booked", markMeetingBooked);

export default router;