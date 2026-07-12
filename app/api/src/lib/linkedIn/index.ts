import { prisma } from "../prisma";
import { logger } from "../logger";

import type { LinkedInProvider, LinkedInAccountContext } from "./linkedin.provider";
import { UnipileLinkedInProvider } from "./Unipile.provider";

export type { LinkedInProvider } from "./linkedin.provider";

export type LinkedInProviderHandle = {
    provider: LinkedInProvider;
    account: LinkedInAccountContext;
};

const LINKEDIN_PROVIDER = (
    process.env.LINKEDIN_PROVIDER ?? "unipile"
).toLowerCase() as "unipile" | "none";

export async function createLinkedInProvider(
    campaignId: string,
): Promise<LinkedInProviderHandle | null> {
    const campaign = await prisma.campaign.findUnique({
        where: {
            id: campaignId,
        },
        select: {
            linkedInAccountId: true,
        },
    });

    if (!campaign) {
        logger.warn({ campaignId }, "[linkedin] Campaign not found");
        return null;
    }

    if (!campaign.linkedInAccountId) {
        logger.debug({ campaignId }, "[linkedin] No LinkedIn account configured");
        return null;
    }

    switch (LINKEDIN_PROVIDER) {
        case "none":
            logger.warn({ campaignId }, "[linkedin] LinkedIn integration disabled");
            return null;

        case "unipile": {
            const baseUrl = process.env.UNIPILE_BASE_URL?.trim();
            const apiKey = process.env.UNIPILE_API_KEY?.trim();

            if (!baseUrl || !apiKey) {
                logger.error(
                    { campaignId, hasBaseUrl: Boolean(baseUrl), hasApiKey: Boolean(apiKey) },
                    "[linkedin] Missing Unipile configuration",
                );
                return null;
            }

            try {
                new URL(baseUrl);
            } catch {
                logger.error({ campaignId, baseUrl }, "[linkedin] Invalid UNIPILE_BASE_URL");
                return null;
            }

            const timeoutMs = Number(process.env.UNIPILE_TIMEOUT_MS ?? "15000");

            const provider = new UnipileLinkedInProvider({
                baseUrl,
                apiKey,
                timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15000,
            });

            const account: LinkedInAccountContext = {
                accountId: campaign.linkedInAccountId,
            };

            return { provider, account };
        }

        default:
            logger.error(
                { campaignId, provider: LINKEDIN_PROVIDER },
                "[linkedin] Unsupported LinkedIn provider",
            );
            return null;
    }
}