import { prisma } from "../../lib/prisma";
import { callGeminiWithTools, MODELS, SchemaType, ToolDefinition } from "./gemini.client";
import { logger } from "../../lib/logger";

const WARMUP_RAMP: Record<number, number> = {
    1: 5,
    2: 8,
    3: 12,
    4: 17,
    5: 23,
    6: 30,
    7: 38,
    14: 60,
    21: 80,
    28: 100,
};

function getBaselineRampPct(warmupDay: number): number {
    const checkpoints = Object.keys(WARMUP_RAMP)
        .map(Number)
        .sort((a, b) => a - b);
    for (const checkpoint of checkpoints) {
        if (warmupDay <= checkpoint) return WARMUP_RAMP[checkpoint];
    }
    return 100;
}

interface WarmupDecision {
    action: "ACCELERATE" | "HOLD" | "COOL_DOWN" | "PAUSE";
    newDailyLimit: number;
    reason: string;
}

const WARMUP_DECISION_TOOL: ToolDefinition = {
    declaration: {
        name: "returnResult",
        description: "Return the warmup decision for this mailbox.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                action: {
                    type: SchemaType.STRING,
                    description:
                        "One of: ACCELERATE (proceed with ramp), HOLD (keep current limit), COOL_DOWN (reduce limit), PAUSE (stop sending due to risk).",
                },
                newDailyLimit: {
                    type: SchemaType.NUMBER,
                    description:
                        "The new daily send limit to set. Must be between 1 and the base daily limit.",
                },
                reason: {
                    type: SchemaType.STRING,
                    description: "One sentence explaining the decision.",
                },
            },
            required: ["action", "newDailyLimit", "reason"],
        },
    },
    handler: async (args) => args,
};

export async function runWarmupAgent(): Promise<void> {
    const mailboxes = await prisma.senderMailbox.findMany({
        where: {
            warmupEnabled: true,
            health: { not: "BLOCKED" },
        },
        select: {
            id: true,
            emailAddress: true,
            dailyLimit: true,
            baseDailyLimit: true,
            createdAt: true,
            warmupStartedAt: true,
            currentSent: true,
            totalSent: true,
            bounceRate: true,
            complaintRate: true,
            reputationScore: true,
            health: true,
        },
    });

    logger.info({ count: mailboxes.length }, "[warmup.agent] Checking mailboxes");

    for (const mailbox of mailboxes) {
        try {
            const now = new Date();
            const msPerDay = 24 * 60 * 60 * 1000;
            const startDate = mailbox.warmupStartedAt ?? mailbox.createdAt;
            const warmupDay = Math.floor((now.getTime() - startDate.getTime()) / msPerDay) + 1;

            if (warmupDay > 28) {
                await prisma.senderMailbox.update({
                    where: { id: mailbox.id },
                    data: { warmupEnabled: false, dailyLimit: mailbox.baseDailyLimit },
                });
                logger.info(
                    { mailboxId: mailbox.id, email: mailbox.emailAddress },
                    "[warmup.agent] Warmup complete — disabling warmup flag",
                );
                continue;
            }

            const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const recentEvents = await prisma.deliverabilityEvent.findMany({
                where: {
                    senderMailboxId: mailbox.id,
                    createdAt: { gte: since7d },
                },
                select: { type: true, severity: true, createdAt: true },
                orderBy: { createdAt: "asc" },
            });

            const baselinePct = getBaselineRampPct(warmupDay);
            const baselineLimit = Math.max(
                1,
                Math.min(Math.round((baselinePct / 100) * mailbox.baseDailyLimit), mailbox.baseDailyLimit),
            );

            const bounceEvents = recentEvents.filter((e) =>
                ["BOUNCE", "SOFT_BOUNCE", "HARD_BOUNCE"].includes(e.type),
            );
            const complaintEvents = recentEvents.filter((e) => e.type === "SPAM_COMPLAINT");
            const blockEvents = recentEvents.filter((e) =>
                ["DOMAIN_BLOCKED", "MAILBOX_BLOCKED"].includes(e.type),
            );

            const { result } = await callGeminiWithTools<WarmupDecision>({
                agentName: "warmup.planner",
                model: MODELS.REVIEW,
                systemPrompt: `You are an email deliverability expert managing mailbox warmup. Analyze the mailbox metrics and recent deliverability events, then decide whether to accelerate the ramp, hold the current limit, cool down, or pause entirely.

Decision rules:
- ACCELERATE: Healthy metrics — follow the baseline ramp schedule
- HOLD: Slightly elevated bounce or complaint rate — stay at current limit, do not grow
- COOL_DOWN: Bounce rate ≥ 3% or complaint rate ≥ 0.08% — reduce limit by 20–30%
- PAUSE: Bounce rate ≥ 8% or complaint rate ≥ 0.3% or block events present — stop sends

The new daily limit must be between 1 and the base daily limit.`,
                userPrompt: `Mailbox: ${mailbox.emailAddress}
Warmup day: ${warmupDay} of 28
Current daily limit: ${mailbox.dailyLimit}
Base daily limit: ${mailbox.baseDailyLimit}
Baseline ramp target for today: ${baselineLimit}

Reputation score: ${mailbox.reputationScore.toFixed(1)} / 100
Bounce rate (lifetime): ${(mailbox.bounceRate * 100).toFixed(2)}%
Complaint rate (lifetime): ${(mailbox.complaintRate * 100).toFixed(3)}%
Current health status: ${mailbox.health}

Last 7 days deliverability events:
- Bounce / soft-bounce / hard-bounce events: ${bounceEvents.length}
- Spam complaint events: ${complaintEvents.length}
- Block events: ${blockEvents.length}
- Total events: ${recentEvents.length}

Event timeline (last 7 days):
${
    recentEvents.length > 0
        ? recentEvents
              .slice(-10)
              .map((e) => `  ${new Date(e.createdAt).toISOString().split("T")[0]} — ${e.type} (${e.severity})`)
              .join("\n")
        : "  No events"
}

Decide the appropriate warmup action and set the new daily limit.`,
                tools: [WARMUP_DECISION_TOOL],
                metadata: { mailboxId: mailbox.id },
                temperature: 0.1,
            });

            const safeLimit = Math.max(
                1,
                Math.min(Math.round(result.newDailyLimit), mailbox.baseDailyLimit),
            );

            const newHealth =
                result.action === "PAUSE"
                    ? "BLOCKED"
                    : result.action === "COOL_DOWN"
                    ? "WARNING"
                    : mailbox.health;

            await prisma.senderMailbox.update({
                where: { id: mailbox.id },
                data: {
                    dailyLimit: safeLimit,
                    ...(result.action === "PAUSE" && { warmupEnabled: false }),
                    health: newHealth,
                },
            });

            logger.info(
                {
                    mailboxId: mailbox.id,
                    email: mailbox.emailAddress,
                    warmupDay,
                    action: result.action,
                    newDailyLimit: safeLimit,
                    reason: result.reason,
                },
                "[warmup.agent] Warmup decision applied",
            );
        } catch (err) {
            logger.error(
                { err, mailboxId: mailbox.id },
                "[warmup.agent] Failed to process mailbox",
            );
        }
    }

    logger.info({ count: mailboxes.length }, "[warmup.agent] Done");
}