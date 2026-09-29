import { Worker } from "bullmq";
import { redisConnectionOptions } from "../../lib/ioredis";
import { logger } from "../../lib/logger";
import { CrmSyncJobData } from "./crm.queue";
import { syncSingleIntegration } from "./crm-sync.service";

new Worker<CrmSyncJobData>(
  "crm-sync",
  async (job) => {
    await syncSingleIntegration(job.data);
  },
  {
    connection: redisConnectionOptions,
    concurrency: 3,
  }
)
  .on("failed", (job, err) => {
    logger.error(
      { jobId: job?.id, integrationId: job?.data.integrationId, leadId: job?.data.leadId, err },
      "[crm.worker] CRM sync job failed permanently"
    );
  })
  .on("completed", (job) => {
    logger.info(
      { jobId: job.id, integrationId: job.data.integrationId, leadId: job.data.leadId },
      "[crm.worker] CRM sync retry succeeded"
    );
  });
