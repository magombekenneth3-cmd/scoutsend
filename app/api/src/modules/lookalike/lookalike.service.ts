import { assertCampaignOwner } from "../../lib/ownership";
import { assertPublicHttpUrl } from "../../lib/url-safety";
import { realtimeQueue } from "../gemini/campaign.queue";
import { prisma } from "../../lib/prisma";

export async function queueLookalikeSearch(params: {
  campaignId: string;
  userId: string;
  clientUrls?: unknown;
}): Promise<void> {
  const { campaignId, userId, clientUrls } = params;

  if (!/^c[a-z0-9]{24}$/.test(campaignId)) {
    throw Object.assign(new Error("Invalid campaign id"), { statusCode: 400 });
  }

  const urls: string[] = [];
  if (clientUrls !== undefined && clientUrls !== null) {
    if (!Array.isArray(clientUrls)) {
      throw Object.assign(new Error("clientUrls must be an array"), { statusCode: 400 });
    }
    if (clientUrls.length > 5) {
      throw Object.assign(new Error("clientUrls must not exceed 5 URLs"), { statusCode: 400 });
    }
    for (const u of clientUrls) {
      if (typeof u !== "string") {
        throw Object.assign(new Error("Each clientUrl must be a string"), { statusCode: 400 });
      }
      await assertPublicHttpUrl(u);
      urls.push(u);
    }
  }

  await assertCampaignOwner(campaignId, userId);

  if (urls.length > 0) {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { enrichmentData: true },
    });
    const existing = (campaign?.enrichmentData ?? {}) as Record<string, unknown>;
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { enrichmentData: { ...existing, clientUrls: urls } },
    });
  }

  const jobId = `run-lookalike-${campaignId}`;
  try {
    await realtimeQueue.add(
      "run-lookalike",
      { campaignId, triggeredBy: userId, clientUrls: urls },
      {
        jobId,
        removeOnComplete: 100,
        removeOnFail: 50,
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Job") && message.includes("already exists")) {
      throw Object.assign(new Error("A lookalike search is already queued for this campaign"), { statusCode: 409 });
    }
    throw err;
  }
}
