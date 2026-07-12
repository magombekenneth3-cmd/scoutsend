import { Router } from "express";
import { authMiddleware } from "../auth/auth.middleware";
import { requireAdmin } from "../auth/auth.rbac";
import { listUsers, getUserStats, updateUserRole, forceLogoutUser, updateProfile } from "./users.controller";

const router = Router();

router.use(authMiddleware);

router.patch("/profile", updateProfile);

router.use(requireAdmin);

router.get("/stats", getUserStats);
router.get("/", listUsers);
router.patch("/:id/role", updateUserRole);
router.post("/:id/force-logout", forceLogoutUser);

export default router;