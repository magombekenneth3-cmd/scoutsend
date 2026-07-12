import { Response, NextFunction } from "express";
import { queueLookalikeSearch } from "../lookalike/lookalike.service";
import { AuthenticatedRequest } from "../auth/auth.types";
import { campaignQueue, maintenanceQueue } from "./campaign.queue";
import { assertCampaignOwner } from "../../lib/ownership";
import { assertPublicHttpUrl } from "../../lib/url-safety";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";

const MAX_CLIENT_URLS = 50;

function isValidCuid(id: string): boolean {
  return /^c[a-z0-9]{24}$/.test(id);
}

function getUser(req: AuthenticatedRequest, res: Response) {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return req.user;
}

function validateId(id: string, res: Response): boolean {
  if (!isValidCuid(id)) {
    res.status(400).json({ error: "Invalid campaign id" });
    return false;
  }
  return true;
}

function handleError(err: unknown, res: Response, next: NextFunction): void {
  if (err && typeof err === "object" && "statusCode" in err) {
    const e = err as { statusCode: number; message: string };
    res.status(e.statusCode).json({ error: e.message });
    return;
  }
  next(err);
}

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  "run-pipeline": ["DRAFT", "FAILED"],
  "pause-pipeline": ["RUNNING", "QUEUED"],
  "resume-pipeline": ["PAUSED"],
};

async function validateTransition(
  jobName: string,
  campaignId: string,
  res: Response,
): Promise<boolean> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { status: true },
  });

  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return false;
  }

  const allowed = ALLOWED_TRANSITIONS[jobName] ?? [];
  if (!allowed.includes(campaign.status)) {
    res.status(409).json({
      error: `Cannot ${jobName.replace("-pipeline", "")} a campaign with status ${campaign.status}`,
    });
    return false;
  }

  return true;
}

function validateClientUrls(raw: unknown, res: Response): string[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    res.status(400).json({ error: "clientUrls must be an array" });
    return null;
  }
  if (raw.length > MAX_CLIENT_URLS) {
    res.status(400).json({ error: `clientUrls must not exceed ${MAX_CLIENT_URLS} entries` });
    return null;
  }

  const seen = new Set<string>();
  const valid: string[] = [];

  for (const url of raw) {
    if (typeof url !== "string") {
      res.status(400).json({ error: "Each clientUrl must be a string" });
      return null;
    }
    try {
      assertPublicHttpUrl(url);
    } catch {
      res.status(400).json({ error: `Invalid or non-public URL: ${url}` });
      return null;
    }
    const key = url.trim().toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      valid.push(url.trim());
    }
  }

  return valid;
}

async function enqueueWithDedup(
  jobName: string,
  payload: Record<string, unknown>,
  jobId: string,
  res: Response,
): Promise<string | null> {
  try {
    const job = await campaignQueue.add(
      jobName,
      { ...payload, enqueuedAt: Date.now() },
      {
        jobId,
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );
    return job.id ?? jobId;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Job") && message.includes("already exists")) {
      res.status(409).json({
        error: "A pipeline job is already queued for this campaign",
      });
      return null;
    }
    throw err;
  }
}

export async function runCampaign(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = getUser(req, res);
    if (!user) return;

    const { id } = req.params as { id: string };
    if (!validateId(id, res)) return;

    await assertCampaignOwner(id, user.userId);
    if (!(await validateTransition("run-pipeline", id, res))) return;

    const jobId = await enqueueWithDedup(
      "run-pipeline",
      { campaignId: id, triggeredBy: user.userId },
      `run-pipeline-${id}`,
      res,
    );

    if (jobId !== null) {
      logger.info({ campaignId: id, userId: user.userId, jobId }, "[campaign] run-pipeline enqueued");
      res.status(202).json({ message: "Campaign pipeline queued", campaignId: id, jobId });
    }
  } catch (error) {
    handleError(error, res, next);
  }
}

export async function pauseCampaign(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = getUser(req, res);
    if (!user) return;

    const { id } = req.params as { id: string };
    if (!validateId(id, res)) return;

    await assertCampaignOwner(id, user.userId);
    if (!(await validateTransition("pause-pipeline", id, res))) return;

    const jobId = await enqueueWithDedup(
      "pause-pipeline",
      { campaignId: id, triggeredBy: user.userId },
      `pause-pipeline-${id}`,
      res,
    );

    if (jobId !== null) {
      logger.info({ campaignId: id, userId: user.userId, jobId }, "[campaign] pause-pipeline enqueued");
      res.status(202).json({ message: "Campaign pause queued", campaignId: id, jobId });
    }
  } catch (error) {
    handleError(error, res, next);
  }
}

export async function resumeCampaign(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = getUser(req, res);
    if (!user) return;

    const { id } = req.params as { id: string };
    if (!validateId(id, res)) return;

    await assertCampaignOwner(id, user.userId);
    if (!(await validateTransition("resume-pipeline", id, res))) return;

    const jobId = await enqueueWithDedup(
      "resume-pipeline",
      { campaignId: id, triggeredBy: user.userId },
      `resume-pipeline-${id}`,
      res,
    );

    if (jobId !== null) {
      logger.info({ campaignId: id, userId: user.userId, jobId }, "[campaign] resume-pipeline enqueued");
      res.status(202).json({ message: "Campaign resume queued", campaignId: id, jobId });
    }
  } catch (error) {
    handleError(error, res, next);
  }
}

export async function runLookalikeSearch(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = getUser(req, res);
    if (!user) return;

    const { id } = req.params as { id: string };
    if (!validateId(id, res)) return;

    await assertCampaignOwner(id, user.userId);

    const { clientUrls: rawUrls } = req.body as { clientUrls?: unknown };
    const clientUrls = validateClientUrls(rawUrls, res);
    if (clientUrls === null) return;

    await queueLookalikeSearch({
      campaignId: id,
      userId: user.userId,
      clientUrls: clientUrls.length > 0 ? clientUrls : undefined,
    });

    logger.info({ campaignId: id, userId: user.userId, urlCount: clientUrls.length }, "[campaign] lookalike-search enqueued");
    res.status(202).json({ message: "Lookalike search queued", campaignId: id });
  } catch (error) {
    handleError(error, res, next);
  }
}

const DISCOVER_ALLOWED_STATUSES = new Set(["DRAFT", "FAILED"]);

export async function discoverLeads(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = getUser(req, res);
    if (!user) return;

    const { id } = req.params as { id: string };
    if (!validateId(id, res)) return;

    await assertCampaignOwner(id, user.userId);

    const campaign = await prisma.campaign.findUnique({
      where: { id },
      select: { status: true, icpDescription: true },
    });

    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }

    if (!DISCOVER_ALLOWED_STATUSES.has(campaign.status)) {
      res.status(409).json({
        error: `Cannot trigger discovery on a campaign with status ${campaign.status}`,
      });
      return;
    }

    if (!campaign.icpDescription?.trim()) {
      res.status(422).json({ error: "Campaign must have an ICP description before running discovery" });
      return;
    }

    const jobId = `discover-leads-${id}`;

    try {
      const job = await maintenanceQueue.add(
        "discover-leads",
        { campaignId: id, triggeredBy: user.userId, enqueuedAt: Date.now() },
        {
          jobId,
          removeOnComplete: { age: 300 },
          removeOnFail: { age: 3600 },
        },
      );

      logger.info({ campaignId: id, userId: user.userId, jobId: job.id }, "[campaign] discover-leads enqueued");
      res.status(202).json({ message: "Lead discovery queued", campaignId: id, jobId: job.id ?? jobId });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("Job") && message.includes("already exists")) {
        res.status(409).json({ error: "Discovery is already running for this campaign" });
        return;
      }
      throw err;
    }
  } catch (error) {
    handleError(error, res, next);
  }
}