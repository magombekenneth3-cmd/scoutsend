import { prisma } from "../prisma";
import { transitionLead } from "../state/lead-state.authority";
import { buildOperationId } from "../events/event-identity";
import { logger } from "../logger";

export interface EmailRevealResult {
    email: string | null;
    validationStatus: "VALID" | "INVALID" | "RISKY" | "UNKNOWN" | "CATCH_ALL";
    provider: string;
}

export async function executeEmailRevealGate(params: {
    leadId: string;
    currentVersion: number;
    currentState: "SCORED";
    score: number;
    threshold: number;
    scoringRunId: string;
}): Promise<void> {
    const { leadId, currentVersion, currentState, score, threshold, scoringRunId } = params;

    if (score < threshold) {
        logger.info(
            { leadId, score, threshold },
            "[email-reveal-gate] Score below threshold — disqualifying lead",
        );

        await transitionLead({
            leadId,
            expectedState: currentState,
            targetState: "DISQUALIFIED",
            expectedVersion: currentVersion,
            operationId: buildOperationId("disqualify", leadId, scoringRunId),
        });

        return;
    }

    await prisma.emailRevealDecision.upsert({
        where: { leadId },
        create: {
            leadId,
            score,
            threshold,
            decision: "REVEAL",
            scoringRunId,
            decidedAt: new Date(),
        },
        update: {
            score,
            threshold,
            decision: "REVEAL",
            scoringRunId,
            decidedAt: new Date(),
        },
    });

    await transitionLead({
        leadId,
        expectedState: currentState,
        targetState: "EMAIL_REVEAL_PENDING",
        expectedVersion: currentVersion,
        operationId: buildOperationId("reveal-gate", leadId, scoringRunId),
        eventPayload: { score, threshold, scoringRunId },
    });

    logger.info(
        { leadId, score, threshold, scoringRunId },
        "[email-reveal-gate] Reveal gate approved — lead transitioned to EMAIL_REVEAL_PENDING",
    );
}

export async function applyEmailValidationOutcome(params: {
    leadId: string;
    currentVersion: number;
    validationStatus: EmailRevealResult["validationStatus"];
    scoringRunId: string;
}): Promise<void> {
    const { leadId, currentVersion, validationStatus, scoringRunId } = params;

    if (validationStatus === "VALID") {
        await transitionLead({
            leadId,
            expectedState: "EMAIL_VALIDATING",
            targetState: "EMAIL_VERIFIED",
            expectedVersion: currentVersion,
            operationId: buildOperationId("email-valid", leadId, scoringRunId),
            eventPayload: { validationStatus },
        });
        return;
    }

    if (validationStatus === "INVALID") {
        await transitionLead({
            leadId,
            expectedState: "EMAIL_VALIDATING",
            targetState: "DISQUALIFIED",
            expectedVersion: currentVersion,
            operationId: buildOperationId("email-invalid", leadId, scoringRunId),
            eventPayload: { validationStatus },
        });
        return;
    }

    await transitionLead({
        leadId,
        expectedState: "EMAIL_VALIDATING",
        targetState: "FAILED_RETRYABLE",
        expectedVersion: currentVersion,
        operationId: buildOperationId("email-risky", leadId, scoringRunId),
        eventPayload: { validationStatus },
    });

    logger.warn(
        { leadId, validationStatus },
        "[email-reveal-gate] RISKY/UNKNOWN email — marked FAILED_RETRYABLE for policy decision",
    );
}
