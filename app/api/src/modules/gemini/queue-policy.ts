export type QueueKey =
  | "orchestrator"
  | "leadResearch"
  | "leadSignal"
  | "leadScoring"
  | "emailEnrichment"
  | "emailGeneration"
  | "send"
  | "linkedin"
  | "realtime"
  | "mailPoll"
  | "maintenance"
  | "learning"
  | "deliveryWebhook";

export interface QueuePolicy {
  queueName: string;
  concurrency: number;
  lockDuration: number;
  limiter?: { max: number; duration: number };
  defaultJobOptions: {
    attempts: number;
    backoff: { type: "exponential" | "fixed"; delay: number };
    removeOnComplete: { age: number };
    removeOnFail: { age: number };
  };
}

export const QUEUE_POLICY: Record<QueueKey, QueuePolicy> = {
  orchestrator: {
    queueName: "campaign-orchestration",
    concurrency: 3,
    lockDuration: 900_000,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 60 * 60 * 24 },
      removeOnFail: { age: 60 * 60 * 24 * 7 },
    },
  },
  leadResearch: {
    queueName: "lead-research",
    concurrency: 12,
    lockDuration: 300_000,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: { age: 60 * 60 * 24 },
      removeOnFail: { age: 60 * 60 * 24 * 7 },
    },
  },
  leadSignal: {
    queueName: "lead-signal-accelerate",
    concurrency: 3,
    lockDuration: 300_000,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 60 * 60 * 24 },
    },
  },
  leadScoring: {
    queueName: "lead-score",
    concurrency: 10,
    lockDuration: 120_000,
    limiter: { max: 60, duration: 60_000 },
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 3_000 },
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 60 * 60 * 24 },
    },
  },
  emailEnrichment: {
    queueName: "email-enrichment",
    concurrency: 8,
    lockDuration: 180_000,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 3_000 },
      removeOnComplete: { age: 60 * 60 * 24 },
      removeOnFail: { age: 60 * 60 * 24 * 7 },
    },
  },
  emailGeneration: {
    queueName: "email-generate",
    concurrency: 5,
    lockDuration: 180_000,
    limiter: { max: 40, duration: 60_000 },
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 60 * 60 * 24 },
    },
  },
  send: {
    queueName: "campaign-send",
    concurrency: 2,
    lockDuration: 120_000,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 300 },
      removeOnFail: { age: 3600 },
    },
  },
  linkedin: {
    queueName: "linkedin-outreach",
    concurrency: 5,
    lockDuration: 180_000,
    limiter: { max: 30, duration: 60_000 },
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 60 * 60 * 24 },
    },
  },
  realtime: {
    queueName: "campaign-realtime",
    concurrency: 10,
    lockDuration: 90_000,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: { age: 300 },
      removeOnFail: { age: 3600 },
    },
  },
  mailPoll: {
    queueName: "mail-poll",
    concurrency: 4,
    lockDuration: 60_000,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 60 * 60 * 24 },
    },
  },
  maintenance: {
    queueName: "campaign-maintenance",
    concurrency: 5,
    lockDuration: 120_000,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "fixed", delay: 30_000 },
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 60 * 60 * 24 },
    },
  },
  learning: {
    queueName: "learning-process",
    concurrency: 3,
    lockDuration: 120_000,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 60 * 60 * 24 },
      removeOnFail: { age: 60 * 60 * 24 * 7 },
    },
  },
  deliveryWebhook: {
    queueName: "delivery-webhook",
    concurrency: 50,
    lockDuration: 30_000,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "fixed", delay: 1_000 },
      removeOnComplete: { age: 0 },
      removeOnFail: { age: 60 * 60 * 24 },
    },
  },
};

export const JOB_PRIORITY = {
  CRITICAL: 1,
  HIGH: 2,
  NORMAL: 5,
  LOW: 10,
} as const;
