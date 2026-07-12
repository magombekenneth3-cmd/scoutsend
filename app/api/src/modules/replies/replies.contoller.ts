import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../auth/auth.types";
import * as RepliesService from "./replies.services";
import {
  createReplySchema,
  updateReplySchema,
  getRepliesQuerySchema,
  markMeetingBookedSchema,
  pipelineStatsQuerySchema,
} from "./repliess.schema";
import { prisma } from "../../lib/prisma";
import { assertCampaignOwner } from "../../lib/ownership";

async function assertReplyOwner(
  reply: { outreachMessage: { lead: { campaignId: string } } } | null,
  userId: string
): Promise<void> {
  if (!reply) throw Object.assign(new Error("Reply not found"), { statusCode: 404 });
  await assertCampaignOwner(reply.outreachMessage.lead.campaignId, userId);
}

export async function createReply(
  req: AuthenticatedRequest, res: Response, next: NextFunction
): Promise<void> {
  try {
    const data = createReplySchema.parse(req.body);
    const userId = req.user!.userId;
    const lead = await prisma.lead.findUnique({
      where: { id: data.leadId },
      select: { campaign: { select: { id: true } } },
    });
    if (!lead) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }
    await assertCampaignOwner(lead.campaign.id, userId);

    const reply = await RepliesService.createReply(data);
    res.status(201).json(reply);
  } catch (error) {
    next(error);
  }
}

export async function getReplies(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const query = getRepliesQuerySchema.parse(req.query);
    const userId = req.user!.userId;
    const result = await RepliesService.getRepliesForUser(userId, query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getReplyById(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const reply = await RepliesService.getReplyById(id);
    await assertReplyOwner(reply, req.user!.userId);
    res.status(200).json(reply);
  } catch (error) {
    next(error);
  }
}

export async function updateReply(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const data = updateReplySchema.parse(req.body);
    const existing = await RepliesService.getReplyById(id);
    await assertReplyOwner(existing, req.user!.userId);
    const reply = await RepliesService.updateReply(id, req.user!.userId, data);
    res.status(200).json(reply);
  } catch (error) {
    next(error);
  }
}

export async function sendReplyDraft(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const existing = await RepliesService.getReplyById(id);
    await assertReplyOwner(existing, req.user!.userId);
    const result = await RepliesService.sendReplyDraft(id, req.user!.userId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function markMeetingBooked(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const { notes } = markMeetingBookedSchema.parse(req.body);
    const existing = await RepliesService.getReplyById(id);
    await assertReplyOwner(existing, req.user!.userId);
    const result = await RepliesService.markMeetingBooked({
      replyId: id,
      userId: req.user!.userId,
      notes,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getPipelineStats(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { campaignId } = pipelineStatsQuerySchema.parse(req.query);
    const userId = req.user!.userId;

    if (campaignId) {
      await assertCampaignOwner(campaignId, userId);
      const stats = await RepliesService.getPipelineStats(campaignId);
      res.status(200).json(stats);
    } else {
      const stats = await RepliesService.getPipelineStatsForUser(userId);
      res.status(200).json(stats);
    }
  } catch (error) {
    next(error);
  }
}