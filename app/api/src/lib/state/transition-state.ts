/**
 * transitionState()
 *
 * The ONLY path for all authoritative status changes.
 *
 * Design contracts:
 *  - Validates against StateTransitionRegistry before any DB write.
 *  - Performs atomic Compare-And-Swap: WHERE id = ? AND status = ? AND version = ?
 *  - Optionally enforces fenced CAS for worker-owned entities:
 *      WHERE ... AND fencingEpoch = ? AND leaseVersion = ?
 *  - Returns `{ success: false }` (never throws) on CAS conflict — the caller
 *    must treat this as a lost race and stop execution.
 *  - Accepts a Prisma transaction client so it can participate in outer
 *    transactions (e.g. alongside OutboxEvent creation).
 *  - Emits structured transition metadata for every call (audit trail).
 *
 * SQL table mapping is hardcoded — dynamic model names are never interpolated
 * directly into SQL to prevent injection.
 */

import type { Prisma } from "@prisma/client";
import { logger } from "../logger";
import {
  validateTransition,
  type StatefulModel,
} from "./state-transition-registry";

// ---------------------------------------------------------------------------
// Hardcoded safe SQL table mapping
// G-comment: prevents dynamic SQL identifier injection
// ---------------------------------------------------------------------------
const STATE_TABLE_COLUMNS: Record<
  StatefulModel,
  { table: string; statusCol: string; versionCol: string }
> = {
  CampaignRun: { table: "CampaignRun", statusCol: "status", versionCol: "version" },
  Campaign: { table: "Campaign", statusCol: "status", versionCol: "version" },
  OutreachMessage: { table: "OutreachMessage", statusCol: "deliveryState", versionCol: "version" },
  SendIntent: { table: "SendIntent", statusCol: "status", versionCol: "version" },
  QuotaReservation: { table: "QuotaReservation", statusCol: "status", versionCol: "version" },
  Operation: { table: "Operation", statusCol: "status", versionCol: "leaseVersion" },
  Lead: { table: "Lead", statusCol: "leadState", versionCol: "version" },
  Company: { table: "Company", statusCol: "", versionCol: "version" },
  WarmupMailbox: { table: "SenderMailbox", statusCol: "warmupState", versionCol: "warmupFenceVersion" },
  WarmupDomain: { table: "SenderDomain", statusCol: "warmupState", versionCol: "warmupFenceVersion" },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Actor performing the transition — recorded in metadata. */
export interface TransitionAuthority {
  /** "WORKER" | "SYSTEM" | "OPERATOR" | "SCHEDULER" */
  actorType: string;
  actorId: string;
  workerId?: string;
  operationId?: string;
  traceId?: string;
}

/** Fencing proof — only required for worker-owned entities. */
export interface FencingProof {
  fencingEpoch: number;
  leaseVersion: number;
}

export interface TransitionParams {
  model: StatefulModel;
  entityId: string;
  /** The state we expect the entity to be in right now (DB is authoritative). */
  expectedState: string;
  expectedVersion: number;
  nextState: string;
  authority: TransitionAuthority;
  /** If provided, transition will additionally CAS on fencingEpoch + leaseVersion. */
  fencing?: FencingProof;
}

export interface TransitionResult {
  success: boolean;
  newVersion: number;
  /** Populated on failure — describes why the CAS was rejected. */
  reason?: "CAS_CONFLICT" | "ILLEGAL_TRANSITION" | "DB_ERROR";
  metadata: TransitionMetadata;
}

export interface TransitionMetadata {
  model: StatefulModel;
  entityId: string;
  fromState: string;
  toState: string;
  expectedVersion: number;
  newVersion: number;
  fencingEpoch?: number;
  leaseVersion?: number;
  actorType: string;
  actorId: string;
  workerId?: string;
  operationId?: string;
  traceId?: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Prisma tx-compatible client type
// ---------------------------------------------------------------------------
type TxClient = Prisma.TransactionClient | typeof import("../prisma").prisma;

// ---------------------------------------------------------------------------
// Core implementation
// ---------------------------------------------------------------------------

/**
 * Transition a model's status atomically with CAS.
 *
 * @param tx   A Prisma transaction client OR the global prisma client.
 *             Pass `tx` when calling inside a `prisma.$transaction()` block.
 * @param params  Transition parameters.
 */
export async function transitionState(
  tx: TxClient,
  params: TransitionParams,
): Promise<TransitionResult> {
  const { model, entityId, expectedState, expectedVersion, nextState, authority, fencing } = params;

  const newVersion = expectedVersion + 1;
  const timestamp = new Date().toISOString();

  const metadata: TransitionMetadata = {
    model,
    entityId,
    fromState: expectedState,
    toState: nextState,
    expectedVersion,
    newVersion,
    fencingEpoch: fencing?.fencingEpoch,
    leaseVersion: fencing?.leaseVersion,
    actorType: authority.actorType,
    actorId: authority.actorId,
    workerId: authority.workerId,
    operationId: authority.operationId,
    traceId: authority.traceId,
    timestamp,
  };

  // 1. Registry validation — throws IllegalStateTransitionError on violation.
  try {
    // Company has no status machine — skip status validation, version-only CAS.
    if (model !== "Company") {
      validateTransition(model, expectedState, nextState);
    }
  } catch (err) {
    logger.warn(
      { ...metadata, err: (err as Error).message },
      "[state] Illegal transition rejected by registry",
    );
    return { success: false, newVersion: expectedVersion, reason: "ILLEGAL_TRANSITION", metadata };
  }

  // 2. Build SQL WHERE clause components.
  //    We use $executeRaw (tagged template) to prevent injection.
  //    Column identifiers are taken from the HARDCODED STATE_TABLE_COLUMNS map.
  const def = STATE_TABLE_COLUMNS[model];

  // Guard: fenced CAS requires model-specific SQL. Validate BEFORE try/catch
  // so programming errors (missing branch) always propagate — never get swallowed.
  if (fencing && model !== "Company" && model !== "CampaignRun" && model !== "SendIntent") {
    throw new Error(
      `[state] UNSUPPORTED_FENCED_MODEL: model '${model}' requested a fenced CAS transition ` +
      `but has no explicit branch in transition-state.ts. Add a branch for this model ` +
      `(see CampaignRun and SendIntent branches as references).`,
    );
  }

  try {
    let updatedCount: number;

    if (model === "Company") {
      // Company: version-only CAS, no status column.
      const result = await (tx as any).$executeRaw`
        UPDATE "Company"
        SET    "version" = ${newVersion},
               "updatedAt" = NOW()
        WHERE  "id"      = ${entityId}
          AND  "version" = ${expectedVersion}
      `;
      updatedCount = result;
    } else if (fencing) {
      // Fenced CAS: includes fencingEpoch + leaseVersion for worker-owned entities.
      if (model === "CampaignRun") {
        const result = await (tx as any).$executeRaw`
          UPDATE "CampaignRun"
          SET    "status"       = ${nextState},
                 "version"      = ${newVersion},
                 "updatedAt"    = NOW()
          WHERE  "id"           = ${entityId}
            AND  "status"       = ${expectedState}
            AND  "version"      = ${expectedVersion}
            AND  "fencingEpoch" = ${fencing.fencingEpoch}
        `;
        updatedCount = result;
      } else {
        // model === "SendIntent" (the only other allowed fenced model, guarded above)
        const result = await (tx as any).$executeRaw`
          UPDATE "SendIntent"
          SET    "status"       = ${nextState},
                 "version"      = ${newVersion},
                 "updatedAt"    = NOW()
          WHERE  "id"           = ${entityId}
            AND  "status"       = ${expectedState}
            AND  "version"      = ${expectedVersion}
            AND  "fencingEpoch" = ${fencing.fencingEpoch}
            AND  "leaseVersion" = ${fencing.leaseVersion}
        `;
        updatedCount = result;
      }
    } else if (model === "CampaignRun") {
      const result = await (tx as any).$executeRaw`
        UPDATE "CampaignRun"
        SET    "status"    = ${nextState},
               "version"   = ${newVersion},
               "updatedAt" = NOW()
        WHERE  "id"        = ${entityId}
          AND  "status"    = ${expectedState}
          AND  "version"   = ${expectedVersion}
      `;
      updatedCount = result;
    } else if (model === "Campaign") {
      const result = await (tx as any).$executeRaw`
        UPDATE "Campaign"
        SET    "status"    = ${nextState},
               "version"   = ${newVersion},
               "updatedAt" = NOW()
        WHERE  "id"        = ${entityId}
          AND  "status"    = ${expectedState}
          AND  "version"   = ${expectedVersion}
      `;
      updatedCount = result;
    } else if (model === "OutreachMessage") {
      const result = await (tx as any).$executeRaw`
        UPDATE "OutreachMessage"
        SET    "deliveryState" = ${nextState},
               "version"       = ${newVersion},
               "updatedAt"     = NOW()
        WHERE  "id"            = ${entityId}
          AND  "deliveryState" = ${expectedState}
          AND  "version"       = ${expectedVersion}
      `;
      updatedCount = result;
    } else if (model === "SendIntent") {
      const result = await (tx as any).$executeRaw`
        UPDATE "SendIntent"
        SET    "status"    = ${nextState},
               "version"   = ${newVersion},
               "updatedAt" = NOW()
        WHERE  "id"        = ${entityId}
          AND  "status"    = ${expectedState}
          AND  "version"   = ${expectedVersion}
      `;
      updatedCount = result;
    } else if (model === "QuotaReservation") {
      const result = await (tx as any).$executeRaw`
        UPDATE "QuotaReservation"
        SET    "status"    = ${nextState},
               "version"   = ${newVersion}
        WHERE  "id"        = ${entityId}
          AND  "status"    = ${expectedState}
          AND  "version"   = ${expectedVersion}
      `;
      updatedCount = result;
    } else if (model === "Operation") {
      const result = await (tx as any).$executeRaw`
        UPDATE "Operation"
        SET    "status"       = ${nextState},
               "leaseVersion" = ${newVersion}
        WHERE  "id"           = ${entityId}
          AND  "status"       = ${expectedState}
          AND  "leaseVersion" = ${expectedVersion}
      `;
      updatedCount = result;
    } else {
      // Lead
      const result = await (tx as any).$executeRaw`
        UPDATE "Lead"
        SET    "leadState" = ${nextState},
               "version"   = ${newVersion},
               "updatedAt" = NOW()
        WHERE  "id"        = ${entityId}
          AND  "leadState" = ${expectedState}
          AND  "version"   = ${expectedVersion}
      `;
      updatedCount = result;
    }

    if (updatedCount === 0) {
      logger.warn(
        metadata,
        "[state] CAS conflict — entity changed since read; transition rejected",
      );
      return { success: false, newVersion: expectedVersion, reason: "CAS_CONFLICT", metadata };
    }

    logger.info(metadata, "[state] Transition committed");
    return { success: true, newVersion, metadata };

  } catch (err) {
    logger.error(
      { ...metadata, err: (err as Error).message },
      "[state] DB error during transition",
    );
    return { success: false, newVersion: expectedVersion, reason: "DB_ERROR", metadata };
  }
}
