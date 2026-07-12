import { Router } from "express";
import { authMiddleware } from "../auth/auth.middleware";
import { requireAdmin } from "../auth/auth.rbac";
import {
    systemHealth,
    platformStats,
    suspendUserHandler,
    deleteUserHandler,
} from "./admin.controller";

const router = Router();

router.use(authMiddleware);
router.use(requireAdmin);

router.get("/health", systemHealth);
router.get("/stats", platformStats);
router.post("/users/:id/suspend", suspendUserHandler);
router.delete("/users/:id", deleteUserHandler);

export default router;