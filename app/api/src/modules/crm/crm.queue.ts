import { Queue } from "bullmq";
import { redisConnectionOptions } from "../../lib/ioredis";

export interface CrmSyncJobData {
  orgId: string;
  leadId: string;
  integrationId: string;
  replyId?: string;
  intent?: string;
  eventType: "POSITIVE_REPLY" | "MEETING_REQUEST" | "ENRICHED_LEAD";
}

export const crmSyncQueue = new Queue<CrmSyncJobData>("crm-sync", {
  connection: redisConnectionOptions,
  defaultJobOptions: {
    attempts: 4,
    backoff: { type: "exponential", delay: 60_000 },
    removeOnComplete: { age: 86_400 },
    removeOnFail: { age: 7 * 86_400 },
  },
});
