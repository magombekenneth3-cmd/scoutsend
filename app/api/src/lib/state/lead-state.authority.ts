/**
 * Lead State Authority
 *
 * Public API for lead state transitions. This module is the ONLY caller
 * of transitionState() for Lead entities. All external code MUST go through
 * this module — never call transitionState() directly for leads.
 *
 * The underlying state machine definition lives in StateTransitionRegistry.
 * This module adds Lead-specific enrichment: outbox event emission,
 * structured logging, and backwards-compatible error types.
 */

import { LeadState } from "@prisma/client";
import { prisma } from "../prisma";
import { logger } from "../logger";
import { transitionState } from "./transition-state";
import type { TransitionAuthority } from "./transition-state";

// ---------------------------------------------------------------------------
// Re-export error types (consumers may depend on these)
// ---------------------------------------------------------------------------

export class InvalidStateTransitionError extends Error {
  constructor(leadId: string, from: LeadState, to: LeadState) {
    super(
      `Invalid Lead state transition: Lead ${leadId} cannot move from ${from} → ${to}`,
    );
    this.name = "InvalidStateTransitionError";
  }
}

export class StateConcurrencyError extends Error {
  constructor(leadId: string) {
    super(
      `State concurrency conflict on Lead ${leadId} — version mismatch`,
    );
    this.name = "StateConcurrencyError";
  }
}

// ---------------------------------------------------------------------------
// Primary API
// ---------------------------------------------------------------------------

export async function transitionLead(params: {
  leadId: string;
  expectedState: LeadState;
  targetState: LeadState;
  expectedVersion: number;
  operationId: string;
  eventPayload?: Record<string, unknown>;
  workerId?: string;
  traceId?: string;
}): Promise<void> {
  const {
    leadId,
    expectedState,
    targetState,
    expectedVersion,
    operationId,
    eventPayload,
    workerId,
    traceId,
  } = params;

  const authority: TransitionAuthority = {
    actorType: workerId ? "WORKER" : "SYSTEM",
    actorId: operationId,
    workerId,
    operationId,
    traceId,
  };

  await prisma.$transaction(async (tx) => {
    // 1. Atomic CAS through the central engine.
    const result = await transitionState(tx, {
      model: "Lead",
      entityId: leadId,
      expectedState,
      expectedVersion,
      nextState: targetState,
      authority,
    });

    if (!result.success) {
      if (result.reason === "ILLEGAL_TRANSITION") {
        throw new InvalidStateTransitionError(leadId, expectedState, targetState);
      }
      if (result.reason === "CAS_CONFLICT") {
        throw new StateConcurrencyError(leadId);
      }
      throw new Error(`[lead-state] Transition failed: ${result.reason}`);
    }

    // 2. Emit outbox event within the same transaction.
    await tx.outboxEvent.create({
      data: {
        organizationId: "org_default",
        aggregateType: "Lead",
        aggregateId: leadId,
        aggregateVersion: result.newVersion,
        eventType: `LEAD_${targetState}`,
        payload: {
          from: expectedState,
          to: targetState,
          operationId,
          version: result.newVersion,
          ...eventPayload,
        },
        operationId,
        idempotencyKey: `${operationId}:${targetState}`,
      },
    });
  });

  logger.info(
    {
      leadId,
      from: expectedState,
      to: targetState,
      operationId,
      version: expectedVersion + 1,
    },
    "[lead-state] Transition applied",
  );
}
