import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../auth/auth.types";
import * as CampaignService from "./campaigns.service";
import { createCampaignSchema, updateCampaignSchema } from "./campaign.shema";
import { isUUID } from "./validate";
import { ValidationError, ConflictError } from "../../lib/errors";
import { getCampaignNarrativeStats } from "./campaigns.narrative";
import { prisma } from "../../lib/prisma";
import { CacheService } from "../../lib/cache";

function assertValidUUID(id: string): void {
  if (!isUUID(id)) {
    throw new ValidationError("Invalid campaign ID");
  }
}

export async function createCampaign(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = createCampaignSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.issues });
      return;
    }
    const campaign = await CampaignService.createCampaign(parsed.data, req.user!.userId);
    await CacheService.invalidateVersioned(`version:campaigns:${req.user!.userId}`);
    res.status(201).json(campaign);
  } catch (error) {
    next(error);
  }
}

export async function getCampaigns(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.userId;
    const baseKey = `cache:campaigns:${userId}`;
    const versionKey = `version:campaigns:${userId}`;
    const campaigns = await CacheService.getOrSetVersioned(
      baseKey,
      versionKey,
      () => CampaignService.getCampaigns(userId)
    );
    res.status(200).json(campaigns);
  } catch (error) {
    next(error);
  }
}

export async function getCampaignById(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    assertValidUUID(id);
    const leadsPage = parseInt(req.query.leadsPage as string ?? "1", 10) || 1;
    const leadsLimit = Math.min(parseInt(req.query.leadsLimit as string ?? "50", 10) || 50, 200);
    const userId = req.user!.userId;
    const baseKey = `cache:campaign:${id}:p${leadsPage}:l${leadsLimit}`;
    const versionKey = `version:campaign:${id}`;
    const campaign = await CacheService.getOrSetVersioned(
      baseKey,
      versionKey,
      () => CampaignService.getCampaignById(id, userId, leadsPage, leadsLimit)
    );
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    res.status(200).json(campaign);
  } catch (error) {
    next(error);
  }
}

export async function updateCampaign(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    assertValidUUID(id);
    const parsed = updateCampaignSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.issues });
      return;
    }
    const campaign = await CampaignService.updateCampaign(id, req.user!.userId, parsed.data);
    await Promise.all([
      CacheService.invalidateVersioned(`version:campaigns:${req.user!.userId}`),
      CacheService.invalidateVersioned(`version:campaign:${id}`)
    ]);
    res.status(200).json(campaign);
  } catch (error) {
    next(error);
  }
}

export async function deleteCampaign(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    assertValidUUID(id);
    await CampaignService.deleteCampaign(id, req.user!.userId);
    await Promise.all([
      CacheService.invalidateVersioned(`version:campaigns:${req.user!.userId}`),
      CacheService.invalidateVersioned(`version:campaign:${id}`)
    ]);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
}

export async function runCampaign(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    assertValidUUID(id);
    const result = await CampaignService.runCampaign(id, req.user!.userId);
    await Promise.all([
      CacheService.invalidateVersioned(`version:campaigns:${req.user!.userId}`),
      CacheService.invalidateVersioned(`version:campaign:${id}`)
    ]);
    res.status(202).json(result);
  } catch (error) {
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === "NOT_RUNNABLE"
    ) {
      res.status(409).json({ error: error.message });
      return;
    }
    next(error);
  }
}

export async function getNarrativeStats(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = req.params.id as string;
    assertValidUUID(id);
    const stats = await getCampaignNarrativeStats(id, req.user!.userId);
    res.json(stats);
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
    const { id } = req.params as { id: string };
    assertValidUUID(id);
    const stats = await CampaignService.getCampaignPipelineStats(id, req.user!.userId);
    res.json(stats);
  } catch (error) {
    next(error);
  }
}

export async function pauseCampaign(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    assertValidUUID(id);
    const result = await CampaignService.pauseCampaign(id, req.user!.userId);
    await Promise.all([
      CacheService.invalidateVersioned(`version:campaigns:${req.user!.userId}`),
      CacheService.invalidateVersioned(`version:campaign:${id}`)
    ]);
    res.json(result);
  } catch (error) {
    if (error instanceof ConflictError) {
      res.status(409).json({ error: error.message });
      return;
    }
    next(error);
  }
}

export async function resumeCampaign(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    assertValidUUID(id);
    const result = await CampaignService.resumeCampaign(id, req.user!.userId);
    await Promise.all([
      CacheService.invalidateVersioned(`version:campaigns:${req.user!.userId}`),
      CacheService.invalidateVersioned(`version:campaign:${id}`)
    ]);
    res.json(result);
  } catch (error) {
    if (error instanceof ConflictError) {
      res.status(409).json({ error: error.message });
      return;
    }
    next(error);
  }
}

export async function getCampaignDiscoveryRuns(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    assertValidUUID(id);

    const campaign = await prisma.campaign.findFirst({
      where: { id, createdById: req.user!.userId },
      select: { id: true },
    });
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }

    const runs = await prisma.discoveryRun.findMany({
      where: { campaignId: id },
      orderBy: { startedAt: "desc" },
      take: 20,
      select: {
        id: true,
        sourceType: true,
        status: true,
        companiesFound: true,
        leadsFound: true,
        signalsFound: true,
        errorMessage: true,
        startedAt: true,
        completedAt: true,
        query: true,
      },
    });

    res.json(runs);
  } catch (error) {
    next(error);
  }
}

export async function getCampaignSignals(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    assertValidUUID(id);

    const campaign = await prisma.campaign.findFirst({
      where: { id, createdById: req.user!.userId },
      select: { id: true },
    });
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }

    const signals = await prisma.leadSignal.findMany({
      where: {
        isActive: true,
        lead: { campaignId: id },
      },
      orderBy: { lastSeenAt: "desc" },
      take: 150,
      select: {
        id: true,
        signalType: true,
        value: true,
        confidence: true,
        source: true,
        explanation: true,
        firstSeenAt: true,
        lastSeenAt: true,
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            companyName: true,
          },
        },
      },
    });

    res.json(signals);
  } catch (error) {
    next(error);
  }
}

export async function listSequenceSteps(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    assertValidUUID(id);

    const campaign = await prisma.campaign.findFirst({
      where: { id, createdById: req.user!.userId },
      select: { id: true },
    });
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }

    const steps = await prisma.sequenceStep.findMany({
      where: { campaignId: id },
      orderBy: { stepIndex: "asc" },
      select: {
        id: true,
        stepIndex: true,
        channel: true,
        trigger: true,
        delayDays: true,
        messageTemplate: true,
        subjectTemplate: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json(steps);
  } catch (error) {
    next(error);
  }
}

export async function createSequenceStep(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    assertValidUUID(id);

    const campaign = await prisma.campaign.findFirst({
      where: { id, createdById: req.user!.userId },
      select: { id: true },
    });
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }

    const count = await prisma.sequenceStep.count({ where: { campaignId: id } });
    if (count >= 10) {
      res.status(400).json({ error: "Maximum of 10 sequence steps per campaign" });
      return;
    }

    const { channel, trigger, delayDays, messageTemplate, subjectTemplate } = req.body as {
      channel: string;
      trigger?: string;
      delayDays?: number;
      messageTemplate?: string;
      subjectTemplate?: string;
    };

    if (!channel) {
      res.status(400).json({ error: "channel is required" });
      return;
    }

    const step = await prisma.sequenceStep.create({
      data: {
        campaignId: id,
        stepIndex: count,
        channel: channel as any,
        trigger: (trigger ?? "AFTER_DELAY") as any,
        delayDays: delayDays ?? 3,
        messageTemplate: messageTemplate ?? null,
        subjectTemplate: subjectTemplate ?? null,
      },
      select: {
        id: true,
        stepIndex: true,
        channel: true,
        trigger: true,
        delayDays: true,
        messageTemplate: true,
        subjectTemplate: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.status(201).json(step);
  } catch (error) {
    next(error);
  }
}

export async function updateSequenceStep(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id, stepId } = req.params as { id: string; stepId: string };
    assertValidUUID(id);
    assertValidUUID(stepId);

    const existing = await prisma.sequenceStep.findFirst({
      where: { id: stepId, campaignId: id, campaign: { createdById: req.user!.userId } },
      select: { id: true },
    });
    if (!existing) {
      res.status(404).json({ error: "Step not found" });
      return;
    }

    const { stepIndex, channel, trigger, delayDays, messageTemplate, subjectTemplate } = req.body as {
      stepIndex?: number;
      channel?: string;
      trigger?: string;
      delayDays?: number;
      messageTemplate?: string | null;
      subjectTemplate?: string | null;
    };

    const step = await prisma.sequenceStep.update({
      where: { id: stepId },
      data: {
        ...(stepIndex !== undefined && { stepIndex }),
        ...(channel !== undefined && { channel: channel as any }),
        ...(trigger !== undefined && { trigger: trigger as any }),
        ...(delayDays !== undefined && { delayDays }),
        ...(messageTemplate !== undefined && { messageTemplate }),
        ...(subjectTemplate !== undefined && { subjectTemplate }),
      },
      select: {
        id: true,
        stepIndex: true,
        channel: true,
        trigger: true,
        delayDays: true,
        messageTemplate: true,
        subjectTemplate: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json(step);
  } catch (error) {
    next(error);
  }
}

export async function deleteSequenceStep(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id, stepId } = req.params as { id: string; stepId: string };
    assertValidUUID(id);
    assertValidUUID(stepId);

    const existing = await prisma.sequenceStep.findFirst({
      where: { id: stepId, campaignId: id, campaign: { createdById: req.user!.userId } },
      select: { id: true, stepIndex: true },
    });
    if (!existing) {
      res.status(404).json({ error: "Step not found" });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.sequenceStep.delete({ where: { id: stepId } });
      const remaining = await tx.sequenceStep.findMany({
        where: { campaignId: id },
        orderBy: { stepIndex: "asc" },
        select: { id: true },
      });
      await Promise.all(
        remaining.map((s, idx) =>
          tx.sequenceStep.update({ where: { id: s.id }, data: { stepIndex: idx } })
        )
      );
    });

    res.status(204).end();
  } catch (error) {
    next(error);
  }
}