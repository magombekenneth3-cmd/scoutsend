import { prisma } from "../prisma";
import { logger } from "../logger";

const LEASE_DURATION_MS = 5 * 60_000;
const MAX_LEASE_RENEWALS = 5;

export interface FencingContext {
  fencingToken: string;
  leaseVersion: number;
  renewLease: () => Promise<void>;
}

export interface ExecuteOperationParams<T> {
  operationId: string;
  aggregateType: string;
  aggregateId: string;
  operationType: string;
  fn: (ctx: FencingContext) => Promise<T>;
}

async function acquireLease(params: {
  operationId: string;
  aggregateType: string;
  aggregateId: string;
  operationType: string;
}): Promise<{ leaseOwner: string; leaseVersion: number }> {
  const { randomUUID } = await import("crypto");
  const leaseOwner = randomUUID();
  const leaseExpiresAt = new Date(Date.now() + LEASE_DURATION_MS);

  const existing = await prisma.operation.findUnique({
    where: { operationId: params.operationId },
    select: { status: true, leaseVersion: true },
  });

  const expectedVersion = existing?.leaseVersion ?? 0;
  const nextVersion = expectedVersion + 1;

  if (existing) {
    const updated = await prisma.operation.updateMany({
      where: {
        operationId: params.operationId,
        leaseVersion: expectedVersion,
        status: { in: ["PENDING", "RECOVERABLE", "LEASE_EXPIRED"] },
      },
      data: {
        status: "RUNNING",
        attempt: { increment: 1 },
        leaseOwner,
        leaseExpiresAt,
        leaseVersion: nextVersion,
        error: null,
      },
    });

    if (updated.count === 0) {
      throw new Error(
        `[operation] Failed to acquire lease for ${params.operationId} — version mismatch or invalid state`,
      );
    }
  } else {
    await prisma.operation.create({
      data: {
        operationId: params.operationId,
        aggregateType: params.aggregateType,
        aggregateId: params.aggregateId,
        operationType: params.operationType,
        status: "RUNNING",
        attempt: 1,
        leaseOwner,
        leaseExpiresAt,
        leaseVersion: nextVersion,
      },
    });
  }

  return { leaseOwner, leaseVersion: nextVersion };
}

async function writeTerminalState(
  operationId: string,
  leaseOwner: string,
  leaseVersion: number,
  status: "SUCCEEDED" | "FAILED",
  resultOrError: { result?: unknown; error?: string },
): Promise<boolean> {
  const updated = await prisma.operation.updateMany({
    where: {
      operationId,
      leaseOwner,
      leaseVersion,
      leaseExpiresAt: { gt: new Date() },
    },
    data: {
      status,
      ...(status === "SUCCEEDED" && {
        result:
          resultOrError.result === undefined || resultOrError.result === null
            ? null
            : (resultOrError.result as any),
      }),
      ...(status === "FAILED" && { error: resultOrError.error }),
      completedAt: new Date(),
      leaseOwner: null,
      leaseExpiresAt: null,
    },
  });

  return updated.count > 0;
}

export async function executeOperation<T>(
  params: ExecuteOperationParams<T>,
): Promise<T> {
  const { operationId, aggregateType, aggregateId, operationType, fn } = params;

  const existing = await prisma.operation.findUnique({
    where: { operationId },
    select: {
      status: true,
      result: true,
      leaseExpiresAt: true,
      leaseOwner: true,
      leaseVersion: true,
    },
  });

  if (existing?.status === "SUCCEEDED") {
    logger.info(
      { operationId, operationType },
      "[operation] Already SUCCEEDED — returning persisted result",
    );
    return existing.result as T;
  }

  if (existing?.status === "RUNNING") {
    const leaseExpired =
      !existing.leaseExpiresAt || existing.leaseExpiresAt < new Date();

    if (!leaseExpired) {
      throw new Error(
        `[operation] ${operationId} is RUNNING with a valid lease — concurrent execution rejected`,
      );
    }

    logger.warn(
      { operationId, operationType, leaseOwner: existing.leaseOwner },
      "[operation] RUNNING with expired lease — transitioning to LEASE_EXPIRED",
    );

    await prisma.operation.updateMany({
      where: {
        operationId,
        leaseOwner: existing.leaseOwner,
        leaseVersion: existing.leaseVersion,
      },
      data: {
        status: "LEASE_EXPIRED",
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
  }

  const { leaseOwner, leaseVersion } = await acquireLease({
    operationId,
    aggregateType,
    aggregateId,
    operationType,
  });

  logger.info(
    { operationId, operationType, aggregateId, leaseOwner, leaseVersion },
    "[operation] Lease acquired — starting",
  );

  let renewalCount = 0;
  const renewLease = async (): Promise<void> => {
    if (renewalCount >= MAX_LEASE_RENEWALS) {
      throw new Error(
        `[operation] ${operationId} exceeded maximum lease renewals (${MAX_LEASE_RENEWALS})`,
      );
    }

    const newExpiry = new Date(Date.now() + LEASE_DURATION_MS);
    const renewed = await prisma.operation.updateMany({
      where: {
        operationId,
        leaseOwner,
        leaseVersion,
        leaseExpiresAt: { gt: new Date() },
      },
      data: { leaseExpiresAt: newExpiry },
    });

    if (renewed.count === 0) {
      throw new Error(
        `[operation] Failed to renew lease for ${operationId} — lease stolen or expired`,
      );
    }

    renewalCount++;
    logger.info(
      { operationId, renewalCount, newExpiry },
      "[operation] Lease renewed",
    );
  };

  const fencingToken = `${leaseOwner}:${leaseVersion}`;

  try {
    const result = await fn({ fencingToken, leaseVersion, renewLease });

    const written = await writeTerminalState(
      operationId,
      leaseOwner,
      leaseVersion,
      "SUCCEEDED",
      { result },
    );

    if (!written) {
      logger.error(
        { operationId },
        "[operation] SUCCEEDED but failed to persist — lease may have been stolen",
      );
      throw new Error(
        `[operation] ${operationId} completed but terminal write failed — lease stolen`,
      );
    }

    logger.info({ operationId, operationType }, "[operation] SUCCEEDED");
    return result;
  } catch (err) {
    await writeTerminalState(
      operationId,
      leaseOwner,
      leaseVersion,
      "FAILED",
      { error: err instanceof Error ? err.message : String(err) },
    ).catch((updateErr) => {
      logger.error(
        { updateErr, operationId },
        "[operation] Failed to record FAILED status — lease may have been stolen",
      );
    });

    logger.error({ operationId, operationType, err }, "[operation] FAILED");
    throw err;
  }
}

export async function recoverExpiredOperations(): Promise<number> {
  const now = new Date();
  const result = await prisma.operation.updateMany({
    where: {
      status: "RUNNING",
      leaseExpiresAt: { lt: now },
    },
    data: {
      status: "LEASE_EXPIRED",
      leaseOwner: null,
      leaseExpiresAt: null,
    },
  });

  if (result.count > 0) {
    logger.warn(
      { count: result.count },
      "[operation] Recovered expired lease operations → LEASE_EXPIRED",
    );
  }

  return result.count;
}
