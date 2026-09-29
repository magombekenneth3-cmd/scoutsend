import { Worker } from "bullmq";
import { z } from "zod";
import { redisConnectionOptions } from "../../../lib/ioredis";
import { QUEUE_POLICY } from "../queue-policy";
import { wireWorkerEvents } from "../worker-runtime";
import { logger } from "../../../lib/logger";
import { parseJobData } from "../../../lib/job-validation";
import { scrapeAndPersistCompanyContext } from "../email-enrichment.agent";

const policy = QUEUE_POLICY.companyScrape;

const scrapeCompanySchema = z.object({
  leadId: z.string().min(1),
  companyId: z.string().min(1),
  website: z.string().min(1),
  forceRefresh: z.boolean().optional(),
});

async function processJob(job: import("bullmq").Job) {
  const { leadId, website, forceRefresh } = parseJobData(scrapeCompanySchema, job);
  const log = logger.child({ jobId: job.id, jobName: job.name, leadId });

  log.info("[companyScrape.worker] scrape-company start");
  await scrapeAndPersistCompanyContext(leadId, website, forceRefresh ?? false);
  return { leadId };
}

export const companyScrapeWorker = new Worker(policy.queueName, processJob, {
  connection: redisConnectionOptions,
  concurrency: policy.concurrency,
  lockDuration: policy.lockDuration,
});

wireWorkerEvents(companyScrapeWorker, policy.queueName);
