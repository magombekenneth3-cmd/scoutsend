import { prisma } from "../prisma";
import { logger } from "../logger";
import { buildOperationId } from "../events/event-identity";
import { INTELLIGENCE_TASK_POLICY, ALL_INTELLIGENCE_TASKS } from "./intelligence-dag";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BarrierDecision =
    | { proceed: true; reason: string; optionalSucceeded: number }
    | { proceed: false; reason: string; retryable: boolean; optionalSucceeded: number };

// ---------------------------------------------------------------------------
// evaluateEvidenceBarrier
//
// Replaces the all-or-nothing areAllIntelligenceTasksComplete with a
// policy-aware evaluation:
//
//   REQUIRED tasks — all must SUCCEED; any FAILED is terminal (retryable: false)
//   OPTIONAL tasks — at least minimumOptionalSucceeded must SUCCEED
//                    OR maximumWaitMs must have elapsed (partial evidence OK)
//
// This ensures a single unavailable enrichment provider cannot block the
// entire lead pipeline indefinitely.
// ---------------------------------------------------------------------------

export async function evaluateEvidenceBarrier(
    leadId: string,
    runId: string,
): Promise<BarrierDecision> {
    const allTaskOpIds = ALL_INTELLIGENCE_TASKS.map((t) =>
        buildOperationId("intel", leadId, t, runId),
    );

    const ops = await prisma.operation.findMany({
        where: {
            operationId: { in: allTaskOpIds },
        },
        select: {
            operationId: true,
            status: true,
            createdAt: true,
        },
    });

    // Build a map: task name → status
    const statusByOpId = new Map(ops.map((op) => [op.operationId, op]));

    // ── 1. Evaluate REQUIRED tasks ──────────────────────────────────────────
    for (const task of INTELLIGENCE_TASK_POLICY.required) {
        const opId = buildOperationId("intel", leadId, task, runId);
        const op = statusByOpId.get(opId);
        const status = op?.status;

        if (status === "FAILED") {
            logger.warn(
                { leadId, runId, task, opId },
                "[evidence-barrier] Required task FAILED — barrier terminal",
            );
            return {
                proceed: false,
                reason: `Required task '${task}' FAILED — pipeline cannot proceed`,
                retryable: false,
                optionalSucceeded: 0,
            };
        }

        if (status !== "SUCCEEDED") {
            return {
                proceed: false,
                reason: `Required task '${task}' not yet SUCCEEDED (status=${status ?? "NOT_STARTED"})`,
                retryable: true,
                optionalSucceeded: 0,
            };
        }
    }

    // ── 2. Evaluate OPTIONAL tasks ──────────────────────────────────────────
    let optionalSucceeded = 0;

    for (const task of INTELLIGENCE_TASK_POLICY.optional) {
        const opId = buildOperationId("intel", leadId, task, runId);
        if (statusByOpId.get(opId)?.status === "SUCCEEDED") {
            optionalSucceeded++;
        }
    }

    if (optionalSucceeded >= INTELLIGENCE_TASK_POLICY.minimumOptionalSucceeded) {
        logger.debug(
            { leadId, runId, optionalSucceeded },
            "[evidence-barrier] Required tasks SUCCEEDED, optional threshold met",
        );
        return {
            proceed: true,
            reason: `Required tasks SUCCEEDED; ${optionalSucceeded}/${INTELLIGENCE_TASK_POLICY.optional.length} optional tasks SUCCEEDED`,
            optionalSucceeded,
        };
    }

    // ── 3. Check maximum wait (allow partial evidence after timeout) ─────────
    const earliestOp = ops.sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    )[0];

    const elapsedMs = earliestOp
        ? Date.now() - earliestOp.createdAt.getTime()
        : 0;

    if (elapsedMs >= INTELLIGENCE_TASK_POLICY.maximumWaitMs) {
        logger.warn(
            {
                leadId,
                runId,
                optionalSucceeded,
                minimumRequired: INTELLIGENCE_TASK_POLICY.minimumOptionalSucceeded,
                elapsedMs,
                maximumWaitMs: INTELLIGENCE_TASK_POLICY.maximumWaitMs,
            },
            "[evidence-barrier] Maximum wait exceeded — proceeding with partial evidence",
        );
        return {
            proceed: true,
            reason: `Maximum wait (${INTELLIGENCE_TASK_POLICY.maximumWaitMs / 60_000}m) exceeded — proceeding with ${optionalSucceeded} optional tasks SUCCEEDED`,
            optionalSucceeded,
        };
    }

    logger.debug(
        {
            leadId,
            runId,
            optionalSucceeded,
            minimumRequired: INTELLIGENCE_TASK_POLICY.minimumOptionalSucceeded,
            elapsedMs,
        },
        "[evidence-barrier] Optional threshold not yet met — retrying",
    );

    return {
        proceed: false,
        reason: `Optional task threshold not met (${optionalSucceeded}/${INTELLIGENCE_TASK_POLICY.minimumOptionalSucceeded}) — waiting`,
        retryable: true,
        optionalSucceeded,
    };
}
