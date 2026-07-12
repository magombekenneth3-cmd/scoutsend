import { Router } from "express";
import { authMiddleware } from "../auth/auth.middleware";
import { requireAdmin } from "../auth/auth.rbac";
import { getAuditLogs } from "./audit.controller";

const router = Router();

router.get("/", authMiddleware, requireAdmin, getAuditLogs);

export default router;