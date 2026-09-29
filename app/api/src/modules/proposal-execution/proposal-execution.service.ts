/**
 * Sprint 8 — Idempotent Proposal Execution & Control Plane Engine
 *
 * LOCATION: app/api/src/modules/proposal-execution/proposal-execution.service.ts
 *
 * ARCHITECTURAL INVARIANT:
 * The LLM proposes. Deterministic code decides. Prisma persists. A proposal executes at most once.
 *
 * EXECUTION FLOW:
 * 1. Verify proposal integrity (proposalHash match over semantic fields).
 * 2. Verify proposal expiration (expiresAt TTL).
 * 3. Reload authoritative context & recompute contextHash (TOCTOU check).
 * 4. Run deterministic policy checks.
 * 5. Atomic ledger gating via Prisma unique constraint on AgentProposalExecution.proposalId.
 *    - Existing SUCCEEDED -> Return idempotent result (0 new DB writes, 0 LLM calls).
 *    - Existing STARTED   -> Throw GatewayExecutionConflictError (concurrency race protection).
 *    - Existing REJECTED  -> Throw GatewayAlreadyExecutedError.
 * 6. Execute business mutation AND mark SUCCEEDED with outreachMessageId in the SAME Prisma transaction.
 */

import { Prisma } from "@prisma/client";
import { AppError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import {
  type AgentProposal,
  verifyProposalIntegrity,
  isProposalExpired,
  GatewayIntegrityError,
  GatewayExpiredProposalError,
  GatewayAlreadyExecutedError,
  GatewayExecutionConflictError,
} from "../../lib/llm-gateway";

export type ProposalExecutionStatus = "STARTED" | "SUCCEEDED" | "FAILED" | "REJECTED";

export interface ProposalResource {
  type: "OUTREACH_MESSAGE" | string;
  id: string;
}

export interface ProposalMutationResult<R> {
  result: R;
  resource?: ProposalResource | null;
}

export class ProposalExecutionIntegrityError extends AppError {
  constructor(message: string) {
    super(message, 500);
    this.name = "ProposalExecutionIntegrityError";
  }
}

export interface ExecuteProposalOnceOptions<T, R> {
  readonly proposal: AgentProposal<T>;
  readonly executeMutation: (
    tx: Prisma.TransactionClient,
    proposal: AgentProposal<T>
  ) => Promise<ProposalMutationResult<R>>;
  readonly reloadAndVerifyContext?: (proposal: AgentProposal<T>) => Promise<void>;
  readonly validatePolicy?: (proposal: AgentProposal<T>) => Promise<void>;
}

export interface ExecuteProposalOnceResult<R> {
  readonly result?: R;
  readonly executionId: string;
  readonly proposalId: string;
  readonly outreachMessageId?: string | null;
  readonly resource?: ProposalResource | null;
  readonly status: ProposalExecutionStatus;
  readonly isIdempotentReplay: boolean;
}

export async function executeProposalOnce<T, R>(
  options: ExecuteProposalOnceOptions<T, R>,
): Promise<ExecuteProposalOnceResult<R>> {
  const { proposal, executeMutation, reloadAndVerifyContext, validatePolicy } = options;

  // 1. Proposal Integrity Verification
  if (!verifyProposalIntegrity(proposal)) {
    logger.warn(
      { agentName: proposal.agentName, proposalId: proposal.proposalId },
      "[proposal-execution] Proposal integrity check failed — payload or metadata tampering detected",
    );
    throw new GatewayIntegrityError(proposal.agentName, proposal.proposalId);
  }

  // 2. Expiration TTL Verification
  if (isProposalExpired(proposal)) {
    logger.warn(
      { agentName: proposal.agentName, proposalId: proposal.proposalId, expiresAt: proposal.expiresAt },
      "[proposal-execution] Proposal has expired",
    );
    throw new GatewayExpiredProposalError(
      proposal.agentName,
      proposal.proposalId,
      proposal.expiresAt ?? new Date(),
    );
  }

  // 3. Authoritative Context Hash TOCTOU Verification
  if (reloadAndVerifyContext) {
    await reloadAndVerifyContext(proposal);
  }

  // 4. Deterministic Policy Verification
  if (validatePolicy) {
    await validatePolicy(proposal);
  }

  // 5. Atomic Execution Ledger Gating (Db Unique Constraint on proposalId)
  let ledger;
  try {
    ledger = await prisma.agentProposalExecution.create({
      data: {
        proposalId: proposal.proposalId,
        proposalHash: proposal.proposalHash,
        requestFingerprint: proposal.requestFingerprint,
        contextHash: proposal.contextHash,
        agentName: proposal.agentName,
        status: "STARTED" as ProposalExecutionStatus,
        startedAt: new Date(),
      },
    });
  } catch (err: unknown) {
    const isP2002 =
      err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
    const isUniqueViolation =
      isP2002 || (err instanceof Error && err.message.includes("Unique constraint"));

    if (isUniqueViolation) {
      const existing: any = await prisma.agentProposalExecution.findUnique({
        where: { proposalId: proposal.proposalId },
      });

      if (existing?.status === "SUCCEEDED") {
        if (!existing.outreachMessageId) {
          throw new ProposalExecutionIntegrityError(
            `SUCCEEDED proposal execution ${proposal.proposalId} has no persisted outreachMessageId identity`,
          );
        }
        logger.info(
          { proposalId: proposal.proposalId, agentName: proposal.agentName, outreachMessageId: existing.outreachMessageId },
          "[proposal-execution] Proposal already executed successfully — returning idempotent replay",
        );
        return {
          executionId: existing.id,
          proposalId: proposal.proposalId,
          outreachMessageId: existing.outreachMessageId,
          resource: { type: "OUTREACH_MESSAGE", id: existing.outreachMessageId },
          status: "SUCCEEDED" as ProposalExecutionStatus,
          isIdempotentReplay: true,
        };
      }

      if (existing?.status === "STARTED") {
        logger.warn(
          { proposalId: proposal.proposalId, agentName: proposal.agentName },
          "[proposal-execution] Concurrent execution conflict — another worker is executing this proposal",
        );
        throw new GatewayExecutionConflictError(proposal.agentName, proposal.proposalId);
      }

      throw new GatewayAlreadyExecutedError(proposal.agentName, proposal.proposalId);
    }

    throw err;
  }

  // 6. Transactional Business Mutation & Ledger Completion in ONE Atomic Prisma Transaction
  try {
    const mutationResult = await prisma.$transaction(async (tx) => {
      const { result: resultVal, resource } = await executeMutation(tx, proposal);

      const outreachMessageId = resource?.type === "OUTREACH_MESSAGE" ? resource.id : null;

      // ATOMIC UPDATE: Mark SUCCEEDED and store outreachMessageId inside the SAME transaction
      await tx.agentProposalExecution.update({
        where: { id: ledger.id },
        data: {
          status: "SUCCEEDED" as ProposalExecutionStatus,
          outreachMessageId,
          completedAt: new Date(),
        } as any,
      });

      return {
        result: resultVal,
        resource: resource ?? null,
        outreachMessageId,
      };
    });

    return {
      result: mutationResult.result,
      executionId: ledger.id,
      proposalId: proposal.proposalId,
      resource: mutationResult.resource,
      outreachMessageId: mutationResult.outreachMessageId,
      status: "SUCCEEDED" as ProposalExecutionStatus,
      isIdempotentReplay: false,
    };
  } catch (mutationErr: unknown) {
    const errorMsg = mutationErr instanceof Error ? mutationErr.message : String(mutationErr);
    const errorCode = mutationErr instanceof Error ? mutationErr.name : "MUTATION_ERROR";

    await prisma.agentProposalExecution.update({
      where: { id: ledger.id },
      data: {
        status: "FAILED" as ProposalExecutionStatus,
        errorCode,
        errorMessage: errorMsg.slice(0, 500),
        completedAt: new Date(),
      },
    }).catch(() => {});

    throw mutationErr;
  }
}
