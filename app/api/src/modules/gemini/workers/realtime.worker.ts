import { Worker } from "bullmq";
import { z } from "zod";
import { redisConnectionOptions } from "../../../lib/ioredis";
import { QUEUE_POLICY } from "../queue-policy";
import { wireWorkerEvents } from "../worker-runtime";
import { logger } from "../../../lib/logger";
import { parseJobData } from "../../../lib/job-validation";
import { processReplyAI } from "../../replies/replies.services";
import { runFollowUpAgent } from "../followup.agent";
import { runObjectionHandlerForCampaign } from "../objection-handler.agent";
import { runLookalikeAgent } from "../../../../../../agents/lookAlike/lookalike.agent";
import { runIcpRefinementAgent } from "../icp.refinementAgent";
import { ingestLeadSignal } from "../signal-ingestion.agent";
import { runLeadAgent } from "../lead-agent.agent";

import { runEmailSequenceAgent } from "../email-sequence.agent";
import { generateDiscoveryScript } from "../discovery-script.agent";

const policy = QUEUE_POLICY.realtime;

const campaignIdSchema = z.object({ campaignId: z.string().min(1) });
const replyIdSchema = z.object({ replyId: z.string().min(1) });
const leadIdSchema = z.object({ leadId: z.string().min(1) });
const runIdSchema = z.object({ runId: z.string().min(1) });
const runLookalikeSchema = z.object({
  campaignId: z.string().min(1),
  triggeredBy: z.string().min(1),
  clientUrls: z.array(z.string()),
  competitorTechUids: z.array(z.string()).optional(),
});
const ingestLeadSignalSchema = z.object({
  leadId: z.string().min(1),
  signalType: z.string().min(1),
  value: z.string(),
  confidence: z.number(),
  source: z.string().optional(),
});

async function processJob(job: import("bullmq").Job) {
  const log = logger.child({ jobId: job.id, jobName: job.name, correlationId: job.data?.correlationId });

  switch (job.name) {
    case "run-email-sequence": {
      const { campaignId } = parseJobData(campaignIdSchema, job);
      log.info({ campaignId }, "[realtime.worker] run-email-sequence start");
      const result = await runEmailSequenceAgent(campaignId);
      return { campaignId, ...result };
    }
    case "process-reply-ai": {
      const { replyId } = parseJobData(replyIdSchema, job);
      log.info({ replyId }, "[realtime.worker] process-reply-ai start");
      await processReplyAI(replyId);
      return { replyId };
    }

    case "run-followup": {
      const { campaignId } = parseJobData(campaignIdSchema, job);
      log.info({ campaignId }, "[realtime.worker] run-followup start");
      await runFollowUpAgent(campaignId);
      return { campaignId };
    }

    case "handle-objections": {
      const { campaignId } = parseJobData(campaignIdSchema, job);
      log.info({ campaignId }, "[realtime.worker] handle-objections start");
      await runObjectionHandlerForCampaign(campaignId);
      return { campaignId };
    }

    case "run-lookalike": {
      const { campaignId, triggeredBy, clientUrls, competitorTechUids } = parseJobData(runLookalikeSchema, job);
      log.info({ campaignId }, "[realtime.worker] run-lookalike start");
      await runLookalikeAgent({ campaignId, userId: triggeredBy, clientUrls, competitorTechUids });
      return { campaignId };
    }

    case "run-icp-refinement": {
      const { campaignId } = parseJobData(campaignIdSchema, job);
      log.info({ campaignId }, "[realtime.worker] run-icp-refinement start");
      await runIcpRefinementAgent(campaignId);
      return { campaignId };
    }

    case "ingest-lead-signal": {
      const { leadId, signalType, value, confidence, source } = parseJobData(ingestLeadSignalSchema, job);
      log.info({ leadId, signalType }, "[realtime.worker] ingest-lead-signal start");
      await ingestLeadSignal({ leadId, signalType, value, confidence, source });
      return { leadId, signalType };
    }

    case "run-lead-agent": {
      const { runId } = parseJobData(runIdSchema, job);
      log.info({ runId }, "[realtime.worker] run-lead-agent start");
      await runLeadAgent(runId);
      return { runId };
    }

    case "generate-discovery-script": {
      const { leadId } = parseJobData(leadIdSchema, job);
      log.info({ leadId }, "[realtime.worker] generate-discovery-script start");
      await generateDiscoveryScript(leadId);
      return { leadId };
    }

    default:
      throw new Error(`[realtime.worker] Unknown job type: ${job.name}`);
  }
}

export const realtimeWorker = new Worker(policy.queueName, processJob, {
  connection: redisConnectionOptions,
  concurrency: policy.concurrency,
  lockDuration: policy.lockDuration,
});

wireWorkerEvents(realtimeWorker, policy.queueName);