import { Router, RequestHandler } from "express";
import { authMiddleware } from "../auth/auth.middleware";
import {
    getSequence,
    putSequence,
    deleteSequence,
    getSequenceStatus,
    getSequenceSummaryHandler,
    requireCampaignOwner,
} from "./sequence.controller";

const router = Router();

router.use(authMiddleware);

router.get("/:id/sequence", requireCampaignOwner as RequestHandler, getSequence as RequestHandler);
router.put("/:id/sequence", requireCampaignOwner as RequestHandler, putSequence as RequestHandler);
router.delete("/:id/sequence", requireCampaignOwner as RequestHandler, deleteSequence as RequestHandler);
router.get("/:id/sequence/status", requireCampaignOwner as RequestHandler, getSequenceStatus as RequestHandler);
router.get("/:id/sequence/summary", requireCampaignOwner as RequestHandler, getSequenceSummaryHandler as RequestHandler);

export default router;