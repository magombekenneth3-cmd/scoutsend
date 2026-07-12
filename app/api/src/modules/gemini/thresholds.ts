import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";

export interface QualityThresholds {
    spamRiskMax: number;
    personalizationMin: number;
}

const DEFAULT_SPAM_RISK_MAX = 0.3;
const DEFAULT_PERSONALIZATION_MIN = 0.7;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_SIZE = 500;

type CacheEntry = {
    value: QualityThresholds;
    expiresAt: number;
};

const cache = new Map<string, CacheEntry>();

export async function getQualityThresholds(campaignId: string): Promise<QualityThresholds> {
    const now = Date.now();
    const cached = cache.get(campaignId);
    if (cached && cached.expiresAt > now) return cached.value;

    let thresholds: QualityThresholds = {
        spamRiskMax: DEFAULT_SPAM_RISK_MAX,
        personalizationMin: DEFAULT_PERSONALIZATION_MIN,
    };

    try {
        const override = await prisma.campaignQualityThreshold.findUnique({
            where: { campaignId },
            select: { spamRiskMax: true, personalizationMin: true },
        });
        if (override) {
            thresholds = {
                spamRiskMax: override.spamRiskMax,
                personalizationMin: override.personalizationMin,
            };
        }
    } catch (err) {
        logger.warn({ err, campaignId }, "[thresholds] Failed to load quality thresholds — using defaults");
    }

    if (cache.size >= CACHE_MAX_SIZE) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey !== undefined) cache.delete(oldestKey);
    }
    cache.set(campaignId, { value: thresholds, expiresAt: now + CACHE_TTL_MS });

    return thresholds;
}

export function invalidateThresholdCache(campaignId: string): void {
    cache.delete(campaignId);
}
