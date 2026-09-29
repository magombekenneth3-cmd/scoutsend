import { prisma } from "../prisma";
import { logger } from "../logger";
import { EmailStatus, LeadState } from "@prisma/client";

export interface DeliveryDecision {
  allowed: boolean;
  reason: string;
  policyVersion: string;
  evaluatedAt: Date;
  checks: EligibilityCheck[];
}

export interface EligibilityCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export const ELIGIBILITY_POLICY_VERSION = "3.3.0";

const TERMINAL_LEAD_STATES = new Set<LeadState>([
  "DISQUALIFIED",
  "SUPPRESSED",
  "UNSUBSCRIBED",
  "BOUNCED",
  "COMPLAINT",
  "SEQUENCE_STOPPED",
  "MEETING_BOOKED",
  "CONVERTED",
  "FAILED_TERMINAL",
]);

const BLOCKED_EMAIL_STATUSES: EmailStatus[] = [
  EmailStatus.INVALID,
  EmailStatus.BOUNCED,
  EmailStatus.SUPPRESSED,
];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function canonicalRecipientEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function evaluateDeliveryEligibility(params: {
  leadId: string;
  campaignId: string;
  orgId: string;
  userId: string;
  email: string | null;
  channel?: string;
}): Promise<DeliveryDecision> {
  const checks: EligibilityCheck[] = [];
  const evaluatedAt = new Date();

  if (!params.email || !EMAIL_REGEX.test(params.email)) {
    checks.push({ name: "email_format", passed: false, detail: "Missing or invalid email" });
    return {
      allowed: false,
      reason: "Missing or invalid recipient email",
      policyVersion: ELIGIBILITY_POLICY_VERSION,
      evaluatedAt,
      checks,
    };
  }
  checks.push({ name: "email_format", passed: true });

  const lead = await prisma.lead.findUnique({
    where: { id: params.leadId },
    select: {
      leadState: true,
      emailStatus: true,
      emailCatchAll: true,
      email: true,
      deletedAt: true,
      lastContactedAt: true,
      recommendedAction: true,
    },
  });

  if (!lead) {
    checks.push({ name: "lead_exists", passed: false });
    return {
      allowed: false,
      reason: "Lead not found",
      policyVersion: ELIGIBILITY_POLICY_VERSION,
      evaluatedAt,
      checks,
    };
  }
  checks.push({ name: "lead_exists", passed: true });

  if (lead.deletedAt) {
    checks.push({ name: "lead_not_deleted", passed: false });
    return {
      allowed: false,
      reason: "Lead is deleted",
      policyVersion: ELIGIBILITY_POLICY_VERSION,
      evaluatedAt,
      checks,
    };
  }
  checks.push({ name: "lead_not_deleted", passed: true });

  if (TERMINAL_LEAD_STATES.has(lead.leadState)) {
    checks.push({ name: "lead_state", passed: false, detail: lead.leadState });
    return {
      allowed: false,
      reason: `Lead in terminal state: ${lead.leadState}`,
      policyVersion: ELIGIBILITY_POLICY_VERSION,
      evaluatedAt,
      checks,
    };
  }
  checks.push({ name: "lead_state", passed: true, detail: lead.leadState });

  if (BLOCKED_EMAIL_STATUSES.includes(lead.emailStatus)) {
    checks.push({ name: "email_status", passed: false, detail: lead.emailStatus });
    return {
      allowed: false,
      reason: `Email status blocked: ${lead.emailStatus}`,
      policyVersion: ELIGIBILITY_POLICY_VERSION,
      evaluatedAt,
      checks,
    };
  }
  checks.push({ name: "email_status", passed: true });

  if (lead.recommendedAction === "DISQUALIFY") {
    checks.push({ name: "recommended_action", passed: false, detail: "DISQUALIFY" });
    return {
      allowed: false,
      reason: "Lead recommended for disqualification",
      policyVersion: ELIGIBILITY_POLICY_VERSION,
      evaluatedAt,
      checks,
    };
  }
  checks.push({ name: "recommended_action", passed: true });

  const campaign = await prisma.campaign.findUnique({
    where: { id: params.campaignId },
    select: {
      status: true,
      catchAllPolicy: true,
      deletedAt: true,
    },
  });

  if (!campaign || campaign.deletedAt) {
    checks.push({ name: "campaign_active", passed: false });
    return {
      allowed: false,
      reason: "Campaign not found or deleted",
      policyVersion: ELIGIBILITY_POLICY_VERSION,
      evaluatedAt,
      checks,
    };
  }

  if (!["QUEUED", "SENDING"].includes(campaign.status)) {
    checks.push({ name: "campaign_status", passed: false, detail: campaign.status });
    return {
      allowed: false,
      reason: `Campaign status not sendable: ${campaign.status}`,
      policyVersion: ELIGIBILITY_POLICY_VERSION,
      evaluatedAt,
      checks,
    };
  }
  checks.push({ name: "campaign_status", passed: true });

  if (campaign.catchAllPolicy === "SKIP" && lead.emailCatchAll) {
    checks.push({ name: "catch_all_policy", passed: false });
    return {
      allowed: false,
      reason: "Catch-all email blocked by campaign policy",
      policyVersion: ELIGIBILITY_POLICY_VERSION,
      evaluatedAt,
      checks,
    };
  }
  checks.push({ name: "catch_all_policy", passed: true });

  const canonicalEmail = canonicalRecipientEmail(params.email);
  const recipientDomain = canonicalEmail.split("@")[1] ?? "";

  const suppression = await prisma.suppression.findFirst({
    where: {
      OR: [
        { email: canonicalEmail, orgId: params.orgId },
        ...(recipientDomain ? [{ domain: recipientDomain, orgId: params.orgId }] : []),
      ],
    },
    select: { id: true, reason: true },
  });

  if (suppression) {
    checks.push({ name: "suppression", passed: false, detail: suppression.reason });
    return {
      allowed: false,
      reason: `Suppressed: ${suppression.reason}`,
      policyVersion: ELIGIBILITY_POLICY_VERSION,
      evaluatedAt,
      checks,
    };
  }
  checks.push({ name: "suppression", passed: true });

  const nonOooReply = await prisma.reply.findFirst({
    where: {
      leadId: params.leadId,
      intent: { not: "OUT_OF_OFFICE" },
    },
    select: { id: true, intent: true },
  });

  if (nonOooReply) {
    checks.push({ name: "no_active_reply", passed: false, detail: nonOooReply.intent });
    return {
      allowed: false,
      reason: `Lead has active reply: ${nonOooReply.intent}`,
      policyVersion: ELIGIBILITY_POLICY_VERSION,
      evaluatedAt,
      checks,
    };
  }
  checks.push({ name: "no_active_reply", passed: true });

  logger.info(
    { leadId: params.leadId, campaignId: params.campaignId },
    "[eligibility] Delivery allowed",
  );

  return {
    allowed: true,
    reason: "All checks passed",
    policyVersion: ELIGIBILITY_POLICY_VERSION,
    evaluatedAt,
    checks,
  };
}
