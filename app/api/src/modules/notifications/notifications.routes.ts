import { Router } from "express";
import { authMiddleware } from "../auth/auth.middleware";
import { requireOrgMembership } from "../auth/auth.org.middleware";
import {
    listNotifications,
    markAsRead,
    markAllAsRead,
} from "./notifications.controller";

const router = Router();

router.use(authMiddleware);
router.use(requireOrgMembership);

router.get("/", listNotifications);
router.post("/read-all", markAllAsRead);
router.patch("/:id/read", markAsRead);

export default router;
