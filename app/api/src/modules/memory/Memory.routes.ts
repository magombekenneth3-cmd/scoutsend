import { Router } from "express";
import { authMiddleware } from "../auth/auth.middleware";
import { getStats, getWins, getLosses } from "./Memory.controller";

const router = Router();

router.use(authMiddleware);

router.get("/stats", getStats);
router.get("/wins", getWins);
router.get("/losses", getLosses);

export default router;