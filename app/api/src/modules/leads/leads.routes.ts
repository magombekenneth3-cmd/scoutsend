import express, { Router } from "express";
import { authMiddleware } from "../auth/auth.middleware";
import {
  createLead,
  deleteLead,
  getLeadById,
  getLeads,
  getLeadJourney,
  importLeadsCsv,
  detectCsvColumns,
  updateLead,
  bulkSuppress,
  bulkRescore,
  bulkEnrichLeads,
  bulkScoreAndEnrich,
  reEnrichLead,
  getLeadCommittee,
  generateResearchCard,
  generateDiscoveryScriptController,
  generateMessageForLeadController,
  bulkEnrollSequence,
  bulkSendEmailBatch,
  bulkUpdateStage,
} from "./leads.controller";

const csvRawParser = express.raw({
  type: ["text/csv", "application/octet-stream", "*/*"],
  limit: "10mb",
});


const router = Router();

router.use(authMiddleware);

router.post("/import/csv/detect", csvRawParser, detectCsvColumns);
router.post("/import/csv", csvRawParser, importLeadsCsv);
router.post("/bulk/suppress", bulkSuppress);
router.post("/bulk/rescore", bulkRescore);
router.post("/bulk/enrich", bulkEnrichLeads);
router.post("/bulk/score-and-enrich", bulkScoreAndEnrich);
router.post("/bulk/stage", bulkUpdateStage);

router.post("/bulk/sequence/enroll", bulkEnrollSequence);
router.post("/bulk/sequence/send-email", bulkSendEmailBatch);
router.post("/", createLead);
router.get("/", getLeads);
router.get("/:id/committee", getLeadCommittee);
router.get("/:id/journey", getLeadJourney);
router.post("/:id/enrich", reEnrichLead);
router.post("/:id/research", generateResearchCard);
router.post("/:id/discovery-script", generateDiscoveryScriptController);
router.post("/:id/generate-message", generateMessageForLeadController);
router.get("/:id", getLeadById);
router.patch("/:id", updateLead);
router.delete("/:id", deleteLead);

export default router;