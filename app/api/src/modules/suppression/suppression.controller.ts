import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../auth/auth.types";
import * as SuppressionService from "./suppression.service";
import {
  createSuppressionSchema,
  checkSuppressionSchema,
  getSuppressionQuerySchema,
} from "./suppression.schema";
import { z } from "zod";

function requireOrg(req: AuthenticatedRequest, res: Response): string | null {
  const orgId = req.user!.orgId;
  if (!orgId) {
    res.status(403).json({ error: "Suppression management requires an organisation" });
    return null;
  }
  return orgId;
}

export async function createSuppression(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const orgId = requireOrg(req, res);
    if (!orgId) return;
    const data = createSuppressionSchema.parse(req.body);
    const suppression = await SuppressionService.createSuppression(orgId, req.user!.userId, data);
    res.status(201).json(suppression);
  } catch (error) {
    next(error);
  }
}

export async function createSuppressionBulk(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const orgId = requireOrg(req, res);
    if (!orgId) return;
    const entries = z.array(createSuppressionSchema).min(1).max(1000).parse(req.body);
    const result = await SuppressionService.createSuppressionBulk(orgId, req.user!.userId, entries);
    res.status(207).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getSuppressions(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const orgId = requireOrg(req, res);
    if (!orgId) return;
    const query = getSuppressionQuerySchema.parse(req.query);
    const result = await SuppressionService.getSuppressions(orgId, query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getSuppressionStats(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const orgId = requireOrg(req, res);
    if (!orgId) return;
    const stats = await SuppressionService.getSuppressionStats(orgId);
    res.status(200).json(stats);
  } catch (error) {
    next(error);
  }
}

export async function checkSuppression(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const orgId = requireOrg(req, res);
    if (!orgId) return;
    const query = checkSuppressionSchema.parse(req.query);
    const result = await SuppressionService.checkSuppression(orgId, query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function deleteSuppression(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const orgId = requireOrg(req, res);
    if (!orgId) return;
    const { id } = req.params as { id: string };
    await SuppressionService.deleteSuppression(orgId, id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}