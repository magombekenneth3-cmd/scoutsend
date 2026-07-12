import { Queue } from "bullmq";
import { createRedisConnection } from "../../lib/ioredis";
import { QUEUE_POLICY } from "./queue-policy";
import { registerForShutdown } from "./worker-runtime";

function makeQueue(key: keyof typeof QUEUE_POLICY): Queue {
  const policy = QUEUE_POLICY[key];
  const queue = new Queue(policy.queueName, {
    connection: createRedisConnection(),
    defaultJobOptions: policy.defaultJobOptions,
  });
  registerForShutdown(queue);
  return queue;
}

export const orchestratorQueue = makeQueue("orchestrator");
export const leadResearchQueue = makeQueue("leadResearch");
export const leadSignalQueue = makeQueue("leadSignal");
export const leadScoringQueue = makeQueue("leadScoring");
export const emailEnrichmentQueue = makeQueue("emailEnrichment");
export const emailGenerationQueue = makeQueue("emailGeneration");
export const sendQueue = makeQueue("send");
export const linkedinQueue = makeQueue("linkedin");
export const realtimeQueue = makeQueue("realtime");
export const mailPollQueue = makeQueue("mailPoll");
export const maintenanceQueue = makeQueue("maintenance");
export const learningQueue = makeQueue("learning");
export const deliveryWebhookQueue = makeQueue("deliveryWebhook");

export const campaignQueue = orchestratorQueue;