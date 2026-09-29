import { Prisma } from "@prisma/client";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { createNotification } from "../notifications/notifications.service";

const POSTMASTER_SCOPE = "https://www.googleapis.com/auth/postmaster.readonly";
const POSTMASTER_BASE = "https://gmailpostmastertools.googleapis.com/v1";

interface GoogleTokenResponse {
    access_token: string;
    expires_in: number;
    token_type: string;
}

interface TrafficStats {
    userReportedSpamRatio?: number;
    domainReputation?: string;
    spammyFeedbackLoopIdentifiers?: string[];
}

async function getAccessToken(saJson: Record<string, string>): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
        JSON.stringify({
            iss: saJson.client_email,
            scope: POSTMASTER_SCOPE,
            aud: "https://oauth2.googleapis.com/token",
            iat: now,
            exp: now + 3600,
        })
    ).toString("base64url");

    const signingInput = `${header}.${payload}`;

    const { createSign } = await import("crypto");
    const sign = createSign("RSA-SHA256");
    sign.update(signingInput);
    const signature = sign.sign(saJson.private_key, "base64url");

    const jwt = `${signingInput}.${signature}`;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
            assertion: jwt,
        }),
        signal: AbortSignal.timeout(10_000),
    });

    if (!tokenRes.ok) {
        throw new Error(`Google token exchange failed: ${tokenRes.status}`);
    }

    const tokenData = await tokenRes.json() as GoogleTokenResponse;
    return tokenData.access_token;
}

async function fetchDomainStats(
    domain: string,
    token: string,
    date: string
): Promise<TrafficStats | null> {
    const url = `${POSTMASTER_BASE}/domains/${encodeURIComponent(domain)}/trafficStats/${date}`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return null;
    if (!res.ok) {
        logger.warn({ domain, status: res.status }, "[postmaster] Failed to fetch traffic stats");
        return null;
    }
    return res.json() as Promise<TrafficStats>;
}

function reputationToScore(rep: string | undefined): number {
    switch (rep) {
        case "HIGH": return 95;
        case "MEDIUM": return 70;
        case "LOW": return 40;
        case "BAD": return 10;
        default: return 100;
    }
}

async function runPostmasterPoll(): Promise<void> {
    const saJsonRaw = process.env.GOOGLE_POSTMASTER_SA_JSON;
    if (!saJsonRaw) return;

    let saJson: Record<string, string>;
    try {
        saJson = JSON.parse(saJsonRaw) as Record<string, string>;
    } catch {
        logger.error("[postmaster] GOOGLE_POSTMASTER_SA_JSON is not valid JSON");
        return;
    }

    const domains = await prisma.senderDomain.findMany({
        where: { health: { not: "BLOCKED" } },
        select: { id: true, domain: true, orgId: true },
    });

    if (domains.length === 0) return;

    let token: string;
    try {
        token = await getAccessToken(saJson);
    } catch (err) {
        logger.error({ err }, "[postmaster] Failed to obtain Google access token");
        return;
    }

    const yesterday = new Date(Date.now() - 86_400_000);
    const dateStr = yesterday.toISOString().slice(0, 10).replace(/-/g, "");

    for (const domain of domains) {
        try {
            const stats = await fetchDomainStats(domain.domain, token, dateStr);
            if (!stats) continue;

            const spamRate = stats.userReportedSpamRatio ?? 0;
            const repScore = reputationToScore(stats.domainReputation);
            const newScore = Math.round((repScore + (1 - spamRate) * 100) / 2);

            const updateData: Prisma.SenderDomainUpdateInput = {
                reputationScore: newScore,
                complaintRate: Math.round(spamRate * 10000) / 100,
            };

            if (stats.domainReputation === "BAD" || spamRate > 0.003) {
                updateData.health = "BLOCKED";
            } else if (stats.domainReputation === "LOW" || spamRate > 0.001) {
                updateData.health = "DEGRADED";
            } else if (stats.domainReputation === "MEDIUM") {
                updateData.health = "WARNING";
            } else {
                updateData.health = "HEALTHY";
            }

            await prisma.senderDomain.update({ where: { id: domain.id }, data: updateData });

            if (
                updateData.health === "BLOCKED" ||
                updateData.health === "DEGRADED"
            ) {
                await prisma.deliverabilityEvent.create({
                    data: {
                        type: updateData.health === "BLOCKED" ? "HEALTH_BLOCKED" : "HEALTH_DEGRADED",
                        severity: updateData.health === "BLOCKED" ? "CRITICAL" : "WARNING",
                        senderDomainId: domain.id,
                        metadata: {
                            spamRate,
                            domainReputation: stats.domainReputation,
                            source: "google_postmaster",
                        } as Prisma.InputJsonValue,
                    },
                });

                if (domain.orgId) {
                    await createNotification(
                        domain.orgId,
                        `Domain health ${updateData.health === "BLOCKED" ? "BLOCKED" : "DEGRADED"}: ${domain.domain}`,
                        `Google Postmaster reported spam rate ${(spamRate * 100).toFixed(3)}% and reputation "${stats.domainReputation ?? "unknown"}". Sending paused.`,
                        updateData.health === "BLOCKED" ? "CRITICAL" : "WARNING"
                    );
                }
            }

            logger.info(
                { domain: domain.domain, spamRate, repScore, newScore, health: updateData.health },
                "[postmaster] Domain stats updated"
            );
        } catch (err) {
            logger.error({ err, domain: domain.domain }, "[postmaster] Error processing domain");
        }
    }
}

let started = false;

export function startPostmasterWorker(): void {
    if (started || !process.env.GOOGLE_POSTMASTER_SA_JSON) return;
    started = true;

    const INTERVAL_MS = 24 * 60 * 60 * 1000;

    const tick = async () => {
        try {
            await runPostmasterPoll();
        } catch (err) {
            logger.error({ err }, "[postmaster] Worker tick failed");
        }
    };

    tick();
    setInterval(tick, INTERVAL_MS);
    logger.info("[postmaster] Worker started — polling every 24h");
}
