/**
 * Recoverable Campaign Failure Classification Service (Sprint 13 P1)
 *
 * Classifies campaign failure reasons and enforces that resumeCampaign() only permits
 * resumption when failure codes are explicitly marked recoverable = true.
 *
 * Non-recoverable failures (COMPLIANCE_REVOKED, OPERATOR_TERMINATED) permanently block
 * resumption unless manually overridden by an authorized admin.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { logger } from "../logger";

export type CampaignFailureCode =
  | "MAILBOX_CONFIGURATION_INVALID"
  | "DAILY_QUOTA_EXHAUSTED"
  | "TEMPORARY_DNS_FAILURE"
  | "CAMPAIGN_CONFIGURATION_INVALID"
  | "DOMAIN_AUTHENTICATION_FAILED"
  | "COMPLIANCE_REVOKED"
  | "OPERATOR_TERMINATED";

export interface CampaignFailureReason {
  code: CampaignFailureCode;
  recoverable: boolean;
  message: string;
  createdAt: string;
  createdBy: string;
}

const FAILURE_RECOVERABILITY_MAP: Record<CampaignFailureCode, boolean> = {
  MAILBOX_CONFIGURATION_INVALID: true,
  DAILY_QUOTA_EXHAUSTED: true,
  TEMPORARY_DNS_FAILURE: true,
  CAMPAIGN_CONFIGURATION_INVALID: false,
  DOMAIN_AUTHENTICATION_FAILED: false,
  COMPLIANCE_REVOKED: false,
  OPERATOR_TERMINATED: false,
};

export function isFailureCodeRecoverable(code: CampaignFailureCode): boolean {
  return FAILURE_RECOVERABILITY_MAP[code] ?? false;
}

export async function markCampaignFailed(params: {
  campaignId: string;
  code: CampaignFailureCode;
  message: string;
  actorId: string;
}): Promise<CampaignFailureReason> {
  const { campaignId, code, message, actorId } = params;
  const recoverable = isFailureCodeRecoverable(code);
  const createdAt = new Date().toISOString();

  const failureReason: CampaignFailureReason = {
    code,
    recoverable,
    message,
    createdAt,
    createdBy: actorId,
  };

  const enrichmentDataPayload: Prisma.InputJsonValue = {
    campaignFailureReason: failureReason as unknown as Prisma.InputJsonValue,
  };

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      status: "FAILED",
      enrichmentData: enrichmentDataPayload,
    },
  });

  logger.warn(
    { campaignId, code, recoverable, actorId },
    "[campaign-failure] Marked campaign as FAILED with structured reason code",
  );

  return failureReason;
}

export async function resumeCampaign(params: {
  campaignId: string;
  actorId: string;
}): Promise<{ resumed: boolean; reason?: string }> {
  const { campaignId, actorId } = params;

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      status: true,
      enrichmentData: true,
    },
  });

  if (!campaign) {
    throw new Error(`Campaign not found: ${campaignId}`);
  }

  if (campaign.status !== "FAILED" && campaign.status !== "PAUSED") {
    return { resumed: false, reason: `Campaign status is ${campaign.status}, not FAILED or PAUSED` };
  }

  // If status is FAILED, verify recoverable flag
  if (campaign.status === "FAILED") {
    const enrichment = (campaign.enrichmentData as any) || {};
    const failureReason = enrichment.campaignFailureReason as CampaignFailureReason | undefined;

    if (failureReason && !failureReason.recoverable) {
      logger.warn(
        { campaignId, failureCode: failureReason.code, actorId },
        "[campaign-failure] Blocked resume attempt on non-recoverable campaign failure",
      );
      return {
        resumed: false,
        reason: `Cannot resume non-recoverable failure code: ${failureReason.code}`,
      };
    }
  }

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      status: "SENDING",
      pausedAt: null,
    },
  });

  logger.info({ campaignId, actorId }, "[campaign-failure] Successfully resumed campaign execution");
  return { resumed: true };
}
