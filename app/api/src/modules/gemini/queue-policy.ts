export type QueueKey =
  | "orchestrator"
  | "leadResearch"
  | "leadSignal"
  | "leadScoring"
  | "emailEnrichment"
  | "companyScrape"
  | "emailGeneration"
  | "send"
  | "linkedin"
  | "realtime"
  | "mailPoll"
  | "maintenance"
  | "learning"
  | "deliveryWebhook"
  | "seedWarmup"
  | "transactional";

export const JOB_PRIORITY = {
  CRITICAL: 1,
  HIGH: 2,
  NORMAL: 5,
  LOW: 10,
} as const;

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
    priority: number;
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
      removeOnFail: { age: 60 * 60 * 24 * 7 }, // 7 days — DLQ recovery window
      priority: JOB_PRIORITY.NORMAL,
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
      priority: JOB_PRIORITY.NORMAL,
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
      priority: JOB_PRIORITY.NORMAL,
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
      priority: JOB_PRIORITY.NORMAL,
    },
  },
  emailEnrichment: {
    queueName: "email-enrichment",
    concurrency: 8,
    lockDuration: 300_000,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 60 * 60 * 24 },
      removeOnFail: { age: 60 * 60 * 24 * 7 },
      priority: JOB_PRIORITY.NORMAL,
    },
  },
  companyScrape: {
    queueName: "company-scrape",
    concurrency: 5,
    lockDuration: 30_000,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 60 * 60 * 24 },
      priority: JOB_PRIORITY.LOW,
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
      priority: JOB_PRIORITY.NORMAL,
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
      removeOnFail: { age: 60 * 60 * 24 * 7 }, // 7 days — crash recovery window for send audit
      priority: JOB_PRIORITY.NORMAL,
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
      priority: JOB_PRIORITY.NORMAL,
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
      priority: JOB_PRIORITY.NORMAL,
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
      priority: JOB_PRIORITY.NORMAL,
    },
  },
  maintenance: {
    queueName: "campaign-maintenance",
    concurrency: 8,
    lockDuration: 300_000,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "fixed", delay: 30_000 },
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 60 * 60 * 24 },
      priority: JOB_PRIORITY.NORMAL,
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
      priority: JOB_PRIORITY.NORMAL,
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
      priority: JOB_PRIORITY.NORMAL,
    },
  },
  seedWarmup: {
    queueName: "seed-warmup",
    concurrency: 5,
    lockDuration: 120_000,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: { age: 60 * 60 * 24 },
      removeOnFail: { age: 60 * 60 * 24 * 7 },
      priority: JOB_PRIORITY.NORMAL,
    },
  },
  transactional: {
    queueName: "transactional-email",
    concurrency: 10,
    lockDuration: 30_000,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 1_000 },
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 60 * 60 * 24 * 7 },
      priority: JOB_PRIORITY.NORMAL,
    },
  },
};