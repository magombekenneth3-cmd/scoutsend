import { Router } from "express";
import { authMiddleware } from "../auth/auth.middleware";
import { requireOrgMembership } from "../auth/auth.org.middleware";
import {
    recordConsentHandler,
    revokeConsentHandler,
    listConsentsHandler,
} from "./consents.controller";

const router = Router();

router.use(authMiddleware);
router.use(requireOrgMembership);

router.get("/", listConsentsHandler);
router.post("/", recordConsentHandler);
router.delete("/:email", revokeConsentHandler);

export default router;
