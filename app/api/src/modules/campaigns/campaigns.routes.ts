import { Router } from "express";
import { authMiddleware } from "../auth/auth.middleware";
import {
  createCampaign, deleteCampaign, getCampaignById,
  getCampaigns, getNarrativeStats, updateCampaign,
  getCampaignDiscoveryRuns, getCampaignSignals,
  getPipelineStats, runCampaign, pauseCampaign, resumeCampaign,
  listSequenceSteps, createSequenceStep, updateSequenceStep, deleteSequenceStep,
} from "./campaigns.controller";

const router = Router();

router.use(authMiddleware);

router.post("/", createCampaign);
router.get("/", getCampaigns);
router.get("/:id", getCampaignById);
router.get("/:id/narrative", getNarrativeStats);
router.get("/:id/pipeline-stats", getPipelineStats);
router.post("/:id/run", runCampaign);
router.post("/:id/pause", pauseCampaign);
router.post("/:id/resume", resumeCampaign);
router.get("/:id/discovery-runs", getCampaignDiscoveryRuns);
router.get("/:id/signals", getCampaignSignals);
router.get("/:id/sequence-steps", listSequenceSteps);
router.post("/:id/sequence-steps", createSequenceStep);
router.patch("/:id/sequence-steps/:stepId", updateSequenceStep);
router.delete("/:id/sequence-steps/:stepId", deleteSequenceStep);
router.patch("/:id", updateCampaign);
router.delete("/:id", deleteCampaign);

export default router;