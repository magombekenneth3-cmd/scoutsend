import { Queue } from "bullmq";
import { redisConnectionOptions } from "../../lib/ioredis";
import { QUEUE_POLICY, JOB_PRIORITY } from "./queue-policy";
import { registerForShutdown } from "./worker-runtime";

function makeQueue(key: keyof typeof QUEUE_POLICY): Queue {
  const policy = QUEUE_POLICY[key];
  const queue = new Queue(policy.queueName, {
    connection: redisConnectionOptions,
    defaultJobOptions: policy.defaultJobOptions,
  });
  registerForShutdown(queue);
  return queue;
}

export const orchestratorQueue = makeQueue("orchestrator");
export const leadResearchQueue = makeQueue("leadResearch");
export const leadSignalQueue = makeQueue("leadSignal");
export const leadScoringQueue = makeQueue("leadScoring");
// emailEnrichmentQueue lives in ./email-enrichment.queue (it needs the
// enqueueEnrichmentBatches helper colocated with it) — re-exported here so
// any import from this module keeps working, without a second Queue client
// competing with the real one for the same "email-enrichment" queue name.
export { emailEnrichmentQueue } from "./email-enrichment.queue";
export const emailGenerationQueue = makeQueue("emailGeneration");
export const sendQueue = makeQueue("send");
export const linkedinQueue = makeQueue("linkedin");
export const realtimeQueue = makeQueue("realtime");
export const mailPollQueue = makeQueue("mailPoll");
export const maintenanceQueue = makeQueue("maintenance");
export const learningQueue = makeQueue("learning");
export const deliveryWebhookQueue = makeQueue("deliveryWebhook");
export const seedWarmupQueue = makeQueue("seedWarmup");
export const transactionalQueue = makeQueue("transactional");

export const campaignQueue = orchestratorQueue;

export async function sendTransactionalEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: string;
}): Promise<void> {
  await transactionalQueue.add("transactional-send", params, { priority: JOB_PRIORITY.CRITICAL });
}