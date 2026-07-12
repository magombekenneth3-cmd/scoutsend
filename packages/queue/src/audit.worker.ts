import { redisConnectionOptions } from "@/app/api/src/lib/ioredis";
import { prisma } from "@/app/api/src/lib/prisma";
import { Worker } from "bullmq";


new Worker(
  "audit-logs",
  async (job) => {
    const { userId, action, entityType, entityId, metadata, ipAddress, userAgent } = job.data;

    if (!userId || !action) {
      return;
    }

    await prisma.auditLog.create({
      data: {
        userId,
        action,
        entityType: entityType ?? "unknown",
        entityId: entityId ?? "unknown",
        metadata: metadata ?? undefined,
        ipAddress: ipAddress ?? undefined,
        userAgent: userAgent ?? undefined,
      },
    });
  },
  { connection: redisConnectionOptions }
);