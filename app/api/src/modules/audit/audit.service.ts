import { auditQueue } from "@/packages/queue/src/audit.queue";

type AuditPayload = {
  userId: string;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
};

export async function logAudit(data: AuditPayload) {
  await auditQueue.add("audit-event", data, {
    attempts: 3,
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
}