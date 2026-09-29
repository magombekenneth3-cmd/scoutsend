import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../auth/auth.types";
import * as OutreachService from "./message.service";
import {
  createOutreachMessageSchema,
  editOutreachMessageSchema,
  getOutreachMessagesQuerySchema,
  chartStatsQuerySchema,
  batchApproveSchema,
  batchRejectSchema,
} from "./message.schema";
import { logAudit } from "../audit/audit.service";
import { AUDIT_EVENTS } from "../../lib/constants";
import { assertCampaignAccess } from "../../lib/ownership";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";

function ua(req: AuthenticatedRequest): string | undefined {
  const h = req.headers["user-agent"];
  return Array.isArray(h) ? h[0] : h;
}

function requireUser(req: AuthenticatedRequest, res: Response): string | null {
  if (!req.user?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return req.user.userId;
}

export async function createOutreachMessage(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;

    const data = createOutreachMessageSchema.parse(req.body);

    const lead = await prisma.lead.findUnique({
      where: { id: data.leadId },
      select: { campaignId: true },
    });
    if (!lead) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }
    await assertCampaignAccess(lead.campaignId, userId, req.user?.orgId);

    const message = await OutreachService.createOutreachMessage(data);

    try {
      await logAudit({
        userId,
        action: AUDIT_EVENTS.EMAIL_SENT,
        entityType: "OutreachMessage",
        entityId: message.id,
        metadata: { leadId: message.leadId },
        ipAddress: req.ip ?? undefined,
        userAgent: ua(req),
      });
    } catch (err) {
      logger.error({ err }, "[audit] createOutreachMessage log failed");
    }

    res.status(201).json(message);
  } catch (error) {
    next(error);
  }
}

export async function getOutreachMessages(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;

    const query = getOutreachMessagesQuerySchema.parse(req.query);
    if (query.campaignId) {
      await assertCampaignAccess(query.campaignId, userId, req.user?.orgId);
    }
    const result = await OutreachService.getOutreachMessages(query, userId, req.user?.orgId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getOutreachMessageById(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;

    const { id } = req.params as { id: string };
    const message = await OutreachService.getOutreachMessageById(id, userId, req.user?.orgId);
    if (!message) {
      res.status(404).json({ error: "Outreach message not found" });
      return;
    }
    res.status(200).json(message);
  } catch (error) {
    next(error);
  }
}

export async function editOutreachMessage(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;

    const { id } = req.params as { id: string };
    const data = editOutreachMessageSchema.parse(req.body);

    const message = await OutreachService.editOutreachMessage(id, data, userId, req.user?.orgId);
    res.status(200).json(message);
  } catch (error) {
    next(error);
  }
}

export async function approveOutreachMessage(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;

    const { id } = req.params as { id: string };
    const message = await OutreachService.approveOutreachMessage(id, userId, req.user?.orgId);

    try {
      await logAudit({
        userId,
        action: AUDIT_EVENTS.MESSAGE_APPROVED,
        entityType: "OutreachMessage",
        entityId: message.id,
        metadata: { leadId: message.leadId, action: "approved" },
        ipAddress: req.ip ?? undefined,
        userAgent: ua(req),
      });
    } catch (err) {
      logger.error({ err }, "[audit] approveOutreachMessage log failed");
    }

    res.status(200).json(message);
  } catch (error) {
    next(error);
  }
}

export async function rejectOutreachMessage(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;

    const { id } = req.params as { id: string };
    const message = await OutreachService.rejectOutreachMessage(id, userId, req.user?.orgId);

    try {
      await logAudit({
        userId,
        action: AUDIT_EVENTS.MESSAGE_REJECTED,
        entityType: "OutreachMessage",
        entityId: message.id,
        metadata: { leadId: message.leadId, action: "rejected" },
        ipAddress: req.ip ?? undefined,
        userAgent: ua(req),
      });
    } catch (err) {
      logger.error({ err }, "[audit] rejectOutreachMessage log failed");
    }

    res.status(200).json(message);
  } catch (error) {
    next(error);
  }
}

export async function sendOutreachMessage(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;

    const { id } = req.params as { id: string };
    const message = await OutreachService.sendOutreachMessage(id, userId, req.user?.orgId);

    try {
      await logAudit({
        userId,
        action: AUDIT_EVENTS.EMAIL_SENT,
        entityType: "OutreachMessage",
        entityId: message.id,
        metadata: { leadId: message.leadId, action: "manual-send" },
        ipAddress: req.ip ?? undefined,
        userAgent: ua(req),
      });
    } catch (err) {
      logger.error({ err }, "[audit] sendOutreachMessage log failed");
    }

    res.status(200).json(message);
  } catch (error) {
    next(error);
  }
}

export async function getChartStats(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;

    const { campaignId, days } = chartStatsQuerySchema.parse(req.query);
    await assertCampaignAccess(campaignId, userId, req.user?.orgId);

    const result = await OutreachService.getChartStats(campaignId, days);
    res.status(200).json({ data: result });
  } catch (error) {
    next(error);
  }
}

export async function batchApproveMessages(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;

    const { campaignId, messageIds } = batchApproveSchema.parse(req.body);
    await assertCampaignAccess(campaignId, userId, req.user?.orgId);

    const result = await OutreachService.batchApproveMessages(campaignId, messageIds, userId, req.user?.orgId);

    try {
      await logAudit({
        userId,
        action: AUDIT_EVENTS.MESSAGE_APPROVED,
        entityType: "OutreachMessage",
        entityId: campaignId,
        metadata: { campaignId, succeeded: result.succeeded.length, failed: result.failed.length },
        ipAddress: req.ip ?? undefined,
        userAgent: ua(req),
      });
    } catch (err) {
      logger.error({ err }, "[audit] batchApproveMessages log failed");
    }

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function batchRejectMessages(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;

    const { campaignId, messageIds } = batchRejectSchema.parse(req.body);
    await assertCampaignAccess(campaignId, userId, req.user?.orgId);

    const result = await OutreachService.batchRejectMessages(campaignId, messageIds, userId, req.user?.orgId);

    try {
      await logAudit({
        userId,
        action: AUDIT_EVENTS.MESSAGE_REJECTED,
        entityType: "OutreachMessage",
        entityId: campaignId,
        metadata: { campaignId, succeeded: result.succeeded.length, failed: result.failed.length },
        ipAddress: req.ip ?? undefined,
        userAgent: ua(req),
      });
    } catch (err) {
      logger.error({ err }, "[audit] batchRejectMessages log failed");
    }

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getStatusCountsHandler(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;

    const campaignId = typeof req.query.campaignId === "string" ? req.query.campaignId : null;
    if (!campaignId) {
      res.status(400).json({ error: "campaignId is required" });
      return;
    }

    await assertCampaignAccess(campaignId, userId, req.user?.orgId);

    const counts = await OutreachService.getStatusCounts(campaignId, userId, req.user?.orgId);
    res.status(200).json(counts);
  } catch (error) {
    next(error);
  }
}