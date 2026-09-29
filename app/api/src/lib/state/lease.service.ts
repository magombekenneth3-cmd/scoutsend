/**
 * Lease Engine — Monotonic Fencing
 *
 * Implements the common lease primitive used by all worker-owned campaign runs.
 *
 * Concepts:
 *   fencingEpoch  — Ownership generation. Incremented on every takeover.
 *                   Worker A holding epoch 10 is permanently invalid after
 *                   Worker B takes over at epoch 11. Lives on CampaignRun itself.
 *   leaseVersion  — Renewal counter within an epoch. Lives on CampaignRunLease.
 *                   Incremented on every renewal. Detects concurrent renewals.
 *
 * Operations:
 *   claimLease    — Atomic claim or fresh-epoch takeover of an expired lease.
 *   renewLease    — CAS-protected heartbeat; returns false if lease was stolen.
 *   takeoverLease — Called when a lease has expired; increments fencingEpoch.
 *   createLeaseMonitor — AbortController-based lease-loss watchdog.
 */

import { prisma } from "../prisma";
import { logger } from "../logger";
import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DEFAULT_LEASE_TTL_MS = 30_000;   // 30 s
const RENEWAL_INTERVAL_MS  = 10_000;   // renew every 10 s

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface ActiveLease {
  campaignRunId: string;
  workerId: string;
  fencingEpoch: number;
  leaseVersion: number;
  expiresAt: Date;
}

export interface ClaimLeaseParams {
  campaignRunId: string;
  workerId?: string;       // defaults to a new UUID
  ttlMs?: number;
}

export type ClaimLeaseResult =
  | { granted: true;  lease: ActiveLease }
  | { granted: false; reason: "LEASE_HELD" | "RUN_NOT_FOUND" | "RUN_TERMINAL" };

export type RenewLeaseResult =
  | { renewed: true;  newVersion: number; expiresAt: Date }
  | { renewed: false; reason: "STOLEN" | "EXPIRED" | "WRONG_EPOCH" };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function leaseExpiry(ttlMs: number): Date {
  return new Date(Date.now() + ttlMs);
}

// ---------------------------------------------------------------------------
// claimLease
// ---------------------------------------------------------------------------
/**
 * Atomically claims a lease on a CampaignRun.
 *
 * Rules:
 *  - If no lease exists for the current epoch → create one.
 *  - If a lease exists but is EXPIRED → takeover: increment fencingEpoch,
 *    insert a new lease row for the new epoch.
 *  - If a lease exists and is still ACTIVE → reject with LEASE_HELD.
 */
export async function claimLease(params: ClaimLeaseParams): Promise<ClaimLeaseResult> {
  const { campaignRunId, ttlMs = DEFAULT_LEASE_TTL_MS } = params;
  const workerId = params.workerId ?? randomUUID();
  const expiresAt = leaseExpiry(ttlMs);

  return await prisma.$transaction(async (tx) => {
    // 1. Load the authoritative run.
    const run = await tx.campaignRun.findUnique({
      where: { id: campaignRunId },
      select: { id: true, fencingEpoch: true, status: true, version: true },
    });

    if (!run) {
      return { granted: false, reason: "RUN_NOT_FOUND" } as const;
    }

    // Terminal runs cannot be leased.
    if (run.status === "COMPLETED" || run.status === "FAILED") {
      return { granted: false, reason: "RUN_TERMINAL" } as const;
    }

    // 2. Check whether a lease already exists for this epoch.
    const existing = await tx.campaignRunLease.findUnique({
      where: { campaignRunId_fencingEpoch: { campaignRunId, fencingEpoch: run.fencingEpoch } },
    });

    if (!existing) {
      // No lease for this epoch — claim it.
      const lease = await tx.campaignRunLease.create({
        data: {
          id: randomUUID(),
          campaignRunId,
          workerId,
          fencingEpoch: run.fencingEpoch,
          leaseVersion: 1,
          leaseExpiresAt: expiresAt,
        },
      });

      logger.info(
        { campaignRunId, workerId, fencingEpoch: run.fencingEpoch, leaseVersion: 1 },
        "[lease] Claimed (fresh epoch)",
      );

      return {
        granted: true,
        lease: {
          campaignRunId,
          workerId,
          fencingEpoch: lease.fencingEpoch,
          leaseVersion: lease.leaseVersion,
          expiresAt: lease.leaseExpiresAt,
        },
      } as const;
    }

    // 3. Lease exists — check expiry.
    const now = new Date();
    if (existing.leaseExpiresAt > now) {
      // Still active and owned by someone else.
      if (existing.workerId !== workerId) {
        logger.info(
          { campaignRunId, heldBy: existing.workerId, epoch: existing.fencingEpoch },
          "[lease] Claim rejected — active lease held",
        );
        return { granted: false, reason: "LEASE_HELD" } as const;
      }

      // Same worker is re-claiming — return existing lease.
      return {
        granted: true,
        lease: {
          campaignRunId,
          workerId: existing.workerId,
          fencingEpoch: existing.fencingEpoch,
          leaseVersion: existing.leaseVersion,
          expiresAt: existing.leaseExpiresAt,
        },
      } as const;
    }

    // 4. Lease EXPIRED — perform takeover.
    //    Atomically increment fencingEpoch on the run, then insert a new lease.
    const newEpoch = run.fencingEpoch + 1;

    const updated = await tx.$executeRaw`
      UPDATE "CampaignRun"
      SET    "fencingEpoch" = ${newEpoch},
             "version"      = "version" + 1,
             "updatedAt"    = NOW()
      WHERE  "id"           = ${campaignRunId}
        AND  "fencingEpoch" = ${run.fencingEpoch}
    `;

    if (updated === 0) {
      // Race: another worker already incremented the epoch.
      logger.warn(
        { campaignRunId, workerId, expectedEpoch: run.fencingEpoch },
        "[lease] Takeover CAS conflict — epoch already incremented by peer",
      );
      return { granted: false, reason: "LEASE_HELD" } as const;
    }

    const newLease = await tx.campaignRunLease.create({
      data: {
        id: randomUUID(),
        campaignRunId,
        workerId,
        fencingEpoch: newEpoch,
        leaseVersion: 1,
        leaseExpiresAt: expiresAt,
      },
    });

    logger.info(
      { campaignRunId, workerId, newEpoch, expiredEpoch: run.fencingEpoch },
      "[lease] Takeover complete — fencingEpoch incremented",
    );

    return {
      granted: true,
      lease: {
        campaignRunId,
        workerId,
        fencingEpoch: newLease.fencingEpoch,
        leaseVersion: newLease.leaseVersion,
        expiresAt: newLease.leaseExpiresAt,
      },
    } as const;
  });
}

// ---------------------------------------------------------------------------
// renewLease
// ---------------------------------------------------------------------------
/**
 * CAS-protected lease renewal.
 *
 * Requires exact (workerId, fencingEpoch, leaseVersion) match.
 * On success, increments leaseVersion and extends expiry.
 *
 * Returns { renewed: false, reason: "STOLEN" } if another worker has
 * taken over or renewed past this worker's version.
 */
export async function renewLease(params: {
  campaignRunId: string;
  workerId: string;
  fencingEpoch: number;
  leaseVersion: number;
  ttlMs?: number;
}): Promise<RenewLeaseResult> {
  const { campaignRunId, workerId, fencingEpoch, leaseVersion, ttlMs = DEFAULT_LEASE_TTL_MS } = params;
  const newExpiry = leaseExpiry(ttlMs);
  const newLeaseVersion = leaseVersion + 1;

  const updated = await prisma.$executeRaw`
    UPDATE "CampaignRunLease"
    SET    "leaseVersion"   = ${newLeaseVersion},
           "leaseExpiresAt" = ${newExpiry}
    WHERE  "campaignRunId" = ${campaignRunId}
      AND  "workerId"      = ${workerId}
      AND  "fencingEpoch"  = ${fencingEpoch}
      AND  "leaseVersion"  = ${leaseVersion}
      AND  "leaseExpiresAt" > NOW()
  `;

  if (updated === 0) {
    logger.warn(
      { campaignRunId, workerId, fencingEpoch, leaseVersion },
      "[lease] Renewal failed — lease stolen or expired",
    );
    return { renewed: false, reason: "STOLEN" };
  }

  logger.debug(
    { campaignRunId, workerId, fencingEpoch, newLeaseVersion, newExpiry },
    "[lease] Renewed",
  );

  return { renewed: true, newVersion: newLeaseVersion, expiresAt: newExpiry };
}

// ---------------------------------------------------------------------------
// createLeaseMonitor
// ---------------------------------------------------------------------------
/**
 * Starts a background interval that renews the lease every RENEWAL_INTERVAL_MS.
 * If renewal fails (lease stolen/expired), aborts the provided AbortController.
 *
 * The caller must pass `signal` to all downstream HTTP requests and tool calls.
 *
 * Usage:
 *   const controller = new AbortController();
 *   const monitor = createLeaseMonitor({ lease, controller });
 *   try {
 *     await doWork({ signal: controller.signal });
 *   } finally {
 *     monitor.stop();
 *   }
 */
export interface LeaseMonitor {
  /** Stop the renewal interval (call in finally block). */
  stop(): void;
  /** Current leaseVersion after renewals. */
  currentLeaseVersion(): number;
}

export function createLeaseMonitor(params: {
  lease: ActiveLease;
  controller: AbortController;
  onLeaseLost?: (reason: string) => void;
}): LeaseMonitor {
  const { controller, onLeaseLost } = params;
  let currentVersion = params.lease.leaseVersion;
  let stopped = false;

  const interval = setInterval(async () => {
    if (stopped || controller.signal.aborted) {
      clearInterval(interval);
      return;
    }

    const result = await renewLease({
      campaignRunId: params.lease.campaignRunId,
      workerId:      params.lease.workerId,
      fencingEpoch:  params.lease.fencingEpoch,
      leaseVersion:  currentVersion,
    });

    if (!result.renewed) {
      clearInterval(interval);
      stopped = true;
      logger.warn(
        { campaignRunId: params.lease.campaignRunId, reason: result.reason },
        "[lease] Lease lost — aborting worker execution",
      );
      onLeaseLost?.(result.reason);
      controller.abort(new Error(`LEASE_LOST: ${result.reason}`));
    } else {
      currentVersion = result.newVersion;
    }
  }, RENEWAL_INTERVAL_MS);

  return {
    stop() {
      stopped = true;
      clearInterval(interval);
    },
    currentLeaseVersion() {
      return currentVersion;
    },
  };
}

// ---------------------------------------------------------------------------
// Convenience: verify a mutation authority before writing to DB
// ---------------------------------------------------------------------------
/**
 * Throws if the provided fencing proof does not match the current live lease.
 * Call this just before performing any authoritative DB mutation in a worker.
 */
export async function assertLeaseOwnership(params: {
  campaignRunId: string;
  workerId: string;
  fencingEpoch: number;
  leaseVersion: number;
}): Promise<void> {
  const { campaignRunId, workerId, fencingEpoch, leaseVersion } = params;

  const lease = await prisma.campaignRunLease.findUnique({
    where: { campaignRunId_fencingEpoch: { campaignRunId, fencingEpoch } },
    select: { workerId: true, leaseVersion: true, leaseExpiresAt: true },
  });

  if (!lease) {
    throw new Error(
      `[lease] assertLeaseOwnership failed: no lease found for epoch ${fencingEpoch} on run ${campaignRunId}`,
    );
  }

  if (lease.workerId !== workerId) {
    throw new Error(
      `[lease] assertLeaseOwnership failed: lease owned by ${lease.workerId}, not ${workerId}`,
    );
  }

  if (lease.leaseVersion !== leaseVersion) {
    throw new Error(
      `[lease] assertLeaseOwnership failed: expected leaseVersion ${leaseVersion}, found ${lease.leaseVersion}`,
    );
  }

  if (lease.leaseExpiresAt < new Date()) {
    throw new Error(
      `[lease] assertLeaseOwnership failed: lease expired at ${lease.leaseExpiresAt.toISOString()}`,
    );
  }
}
