import { prisma } from "../prisma";
import { logger } from "../logger";
import { canonicalRecipientEmail } from "../leads/eligibility.service";

export interface SuppressionCheckResult {
  suppressed: boolean;
  reason: string | null;
  matchedOn: "email" | "domain" | null;
  checkedAt: Date;
}

export async function checkSuppression(params: {
  email: string;
  orgId: string;
}): Promise<SuppressionCheckResult> {
  const checkedAt = new Date();
  const canonical = canonicalRecipientEmail(params.email);
  const recipientDomain = canonical.includes("@") ? canonical.split("@")[1] : "";

  const match = await prisma.suppression.findFirst({
    where: {
      orgId: params.orgId,
      OR: [
        { email: canonical },
        ...(recipientDomain ? [{ domain: recipientDomain }] : []),
      ],
    },
    select: { email: true, domain: true, reason: true },
  });

  if (!match) {
    return { suppressed: false, reason: null, matchedOn: null, checkedAt };
  }

  const matchedOn = match.email ? "email" as const : "domain" as const;

  logger.info(
    { email: canonical, orgId: params.orgId, matchedOn, reason: match.reason },
    "[suppression] Suppressed",
  );

  return {
    suppressed: true,
    reason: match.reason,
    matchedOn,
    checkedAt,
  };
}
