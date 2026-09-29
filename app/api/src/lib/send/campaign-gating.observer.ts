/**
 * Campaign Health & Blockage Observer (Sprint 13 P1)
 *
 * Evaluates system gating conditions (circuit breakers, precedence kill switches,
 * mailbox limits, and domain health) independently from campaign aggregate outcome status.
 *
 * INVARIANT: System gating sets executionGate = BLOCKED without overwriting or corrupting
 * underlying campaign outcome calculations (CONVERGING, NEEDS_REVIEW, COMPLETED, PARTIAL).
 */

import { prisma } from "../prisma";
import { isKillSwitchActive } from "./dispatch-kill-switch.service";
import { getCircuitState } from "./provider-circuit-breaker.service";

export interface CampaignGatingEvaluation {
  campaignId: string;
  executionGate: "RUNNABLE" | "BLOCKED" | "PAUSED";
  blockingReasons: string[];
  evaluatedAt: string;
}

export async function checkCampaignGatingConditions(
  campaignId: string,
): Promise<CampaignGatingEvaluation> {
  const evaluatedAt = new Date().toISOString();
  const blockingReasons: string[] = [];

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      status: true,
      orgId: true,
      senderMailboxId: true,
      senderMailbox: {
        select: {
          id: true,
          providerType: true,
          health: true,
        },
      },
    },
  });

  if (!campaign) {
    throw new Error(`Campaign not found: ${campaignId}`);
  }

  if (campaign.status === "PAUSED") {
    return {
      campaignId,
      executionGate: "PAUSED",
      blockingReasons: ["OPERATOR_PAUSED"],
      evaluatedAt,
    };
  }

  const providerName = campaign.senderMailbox?.providerType ?? "SMTP";
  const mailboxId = campaign.senderMailboxId ?? undefined;

  // 1. Check Provider Circuit Breakers
  const circuitState = getCircuitState(providerName);
  if (circuitState === "OPEN") {
    blockingReasons.push(`PROVIDER_CIRCUIT_OPEN:${providerName}`);
  }

  // 2. Check Precedence Kill Switches
  const killSwitchResult = isKillSwitchActive({
    organizationId: campaign.orgId,
    providerName,
    mailboxId,
    campaignId,
  });

  if (killSwitchResult.blocked) {
    blockingReasons.push(`KILL_SWITCH_ACTIVE:${killSwitchResult.activeScope ?? "GLOBAL"}`);
  }

  // 3. Check Mailbox Health Status
  if (campaign.senderMailbox) {
    const health = campaign.senderMailbox.health;
    if (health === "BLOCKED" || health === "DEGRADED") {
      blockingReasons.push(`MAILBOX_HEALTH_${health}`);
    }
  }

  const executionGate = blockingReasons.length > 0 ? "BLOCKED" : "RUNNABLE";

  return {
    campaignId,
    executionGate,
    blockingReasons,
    evaluatedAt,
  };
}
