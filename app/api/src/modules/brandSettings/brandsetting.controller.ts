import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../auth/auth.types";
import * as BrandSettingsService from "./brandsettings.service";
import { upsertBrandSettingsSchema, SAFE_FONT_STACKS_LIST } from "./brandsetting.schema";
import { CacheService } from "../../lib/cache";

// ─── GET /brand-settings ──────────────────────────────────────────────────────

export async function getBrandSettings(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.userId;
    const cacheKey = `cache:brand-settings:${userId}`;
    const result = await CacheService.getOrSet(cacheKey, async () => {
      const settings = await BrandSettingsService.getBrandSettings(userId);
      return {
        data: settings,
        configured: !!settings,
      };
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

// ─── PUT /brand-settings ──────────────────────────────────────────────────────
// PUT (not PATCH) — brand settings are always replaced in full.
// The frontend sends the complete form on every save.

export async function upsertBrandSettings(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = upsertBrandSettingsSchema.parse(req.body);
    const settings = await BrandSettingsService.upsertBrandSettings(
      req.user!.userId,
      data
    );
    await CacheService.invalidate(`cache:brand-settings:${req.user!.userId}`);
    res.status(200).json(settings);
  } catch (error) {
    next(error);
  }
}

// ─── GET /brand-settings/preview ─────────────────────────────────────────────
// Returns a fully rendered HTML email using the user's brand settings.
// The frontend renders this in an <iframe> so users see exactly what
// recipients will see before any campaign goes live.

export async function previewBrandEmail(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const html = await BrandSettingsService.previewBrandEmail(req.user!.userId);
    // Return raw HTML — frontend drops this into an iframe
    res.setHeader("Content-Type", "text/html");
    res.status(200).send(html);
  } catch (error) {
    next(error);
  }
}

// ─── GET /brand-settings/fonts ───────────────────────────────────────────────
// Returns the list of supported font stacks for the frontend font picker.

export async function getSupportedFonts(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    res.status(200).json({ fonts: SAFE_FONT_STACKS_LIST });
  } catch (error) {
    next(error);
  }
}