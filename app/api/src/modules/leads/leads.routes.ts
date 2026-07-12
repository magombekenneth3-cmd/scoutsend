
import { Router } from "express";
import { authMiddleware } from "../auth/auth.middleware";
import {
  createLead,
  deleteLead,
  getLeadById,
  getLeads,
  importLeadsCsv,
  updateLead,
  bulkSuppress,
  bulkRescore,
  bulkEnrichLeads,
  reEnrichLead,
  getLeadCommittee,
  generateResearchCard,
  generateMessageForLeadController,
} from "./leads.controller";

const router = Router();

router.use(authMiddleware);

router.post("/import/csv", importLeadsCsv);
router.post("/bulk/suppress", bulkSuppress);
router.post("/bulk/rescore", bulkRescore);
router.post("/bulk/enrich", bulkEnrichLeads);
router.post("/", createLead);
router.get("/", getLeads);
router.get("/:id/committee", getLeadCommittee);
router.post("/:id/enrich", reEnrichLead);
router.post("/:id/research", generateResearchCard);
router.post("/:id/generate-message", generateMessageForLeadController);
router.get("/:id", getLeadById);
router.patch("/:id", updateLead);
router.delete("/:id", deleteLead);

export default router;