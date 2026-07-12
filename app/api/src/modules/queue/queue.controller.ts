import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../auth/auth.types";
import * as QueueJobsService from "./queue.service";
import { getQueueJobsQuerySchema } from "./queue.schema";

export async function getQueueJobs(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.userId;
    const query = getQueueJobsQuerySchema.parse(req.query);
    const result = await QueueJobsService.getQueueJobs(query, userId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getQueueJobById(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id } = req.params as { id: string };
    const job = await QueueJobsService.getQueueJobById(id, userId);
    if (!job) {
      res.status(404).json({ error: "Queue job not found" });
      return;
    }
    res.status(200).json(job);
  } catch (error) {
    next(error);
  }
}

export async function getQueueStats(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const stats = await QueueJobsService.getQueueStats();
    res.status(200).json(stats);
  } catch (error) {
    next(error);
  }
}

export async function retryQueueJob(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { id } = req.params as { id: string };
    const job = await QueueJobsService.retryQueueJob(id, userId);
    res.status(200).json(job);
  } catch (error) {
    next(error);
  }
}