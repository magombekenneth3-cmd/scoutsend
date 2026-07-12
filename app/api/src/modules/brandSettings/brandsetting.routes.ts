import { Router } from "express";
import { authMiddleware } from "../auth/auth.middleware";
import {
  getBrandSettings,
  upsertBrandSettings,
  previewBrandEmail,
  getSupportedFonts,
} from "./brandsetting.controller";

const router = Router();

router.use(authMiddleware);

// Static routes before dynamic ones
router.get("/preview", previewBrandEmail);
router.get("/fonts", getSupportedFonts);
router.get("/", getBrandSettings);
router.put("/", upsertBrandSettings);

export default router;