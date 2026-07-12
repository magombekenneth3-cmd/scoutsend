import { redis } from "../../../lib/ioredis";
import { logger } from "../../../lib/logger";
import { redisKeys } from "./redis.keys";
import { CHECKPOINT_TTL_S } from "./discovery.constants";
import type { DiscoveryCheckpoint } from "./discovery.types";

export async function saveCheckpoint(campaignId: string, checkpoint: DiscoveryCheckpoint): Promise<void> {
    try {
        await redis.set(
            redisKeys.checkpoint(campaignId),
            JSON.stringify(checkpoint),
            "EX",
            CHECKPOINT_TTL_S,
        );
    } catch (err) {
        logger.warn({ err, campaignId }, "[discovery] Checkpoint save failed");
    }
}

export async function loadCheckpoint(campaignId: string): Promise<DiscoveryCheckpoint | null> {
    try {
        const raw = await redis.get(redisKeys.checkpoint(campaignId));
        if (!raw) return null;
        return JSON.parse(raw) as DiscoveryCheckpoint;
    } catch {
        return null;
    }
}

export async function clearCheckpoint(campaignId: string): Promise<void> {
    try {
        await redis.del(redisKeys.checkpoint(campaignId));
    } catch {
    }
}

export async function isCancelled(campaignId: string): Promise<boolean> {
    try {
        const flag = await redis.get(redisKeys.cancel(campaignId));
        return flag === "1";
    } catch {
        return false;
    }
}