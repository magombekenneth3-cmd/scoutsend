import { Queue } from "bullmq";
import { redisConnectionOptions } from "@/app/api/src/lib/ioredis";

export const auditQueue = new Queue("audit-logs", {
  connection: redisConnectionOptions,
  defaultJobOptions: {
    removeOnComplete: { age: 3_600, count: 100 },
    removeOnFail: { age: 86_400, count: 500 },
  },
});