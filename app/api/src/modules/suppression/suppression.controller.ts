import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../auth/auth.types";
import * as SuppressionService from "./suppression.service";
import {
  createSuppressionSchema,
  checkSuppressionSchema,
  getSuppressionQuerySchema,
} from "./suppression.schema";
import { z } from "zod";

export async function createSuppression(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.userId;
    const data = createSuppressionSchema.parse(req.body);
    const suppression = await SuppressionService.createSuppression(userId, data);
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
    const userId = req.user!.userId;
    const entries = z.array(createSuppressionSchema).min(1).max(1000).parse(req.body);
    const result = await SuppressionService.createSuppressionBulk(userId, entries);
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
    const userId = req.user!.userId;
    const query = getSuppressionQuerySchema.parse(req.query);
    const result = await SuppressionService.getSuppressions(userId, query);
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
    const userId = req.user!.userId;
    const stats = await SuppressionService.getSuppressionStats(userId);
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
    const userId = req.user!.userId;
    const query = checkSuppressionSchema.parse(req.query);
    const result = await SuppressionService.checkSuppression(userId, query);
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
    const userId = req.user!.userId;
    const { id } = req.params as { id: string };
    await SuppressionService.deleteSuppression(userId, id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}