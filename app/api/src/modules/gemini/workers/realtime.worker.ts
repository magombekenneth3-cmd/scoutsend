import { Worker } from "bullmq";
import { createRedisConnection } from "../../../lib/ioredis";
import { QUEUE_POLICY } from "../queue-policy";
import { wireWorkerEvents } from "../worker-runtime";
import { logger } from "../../../lib/logger";
import { processReplyAI } from "../../replies/replies.services";
import { runFollowUpAgent } from "../followup.agent";
import { runObjectionHandlerForCampaign } from "../objection-handler.agent";
import { runLookalikeAgent } from "../../../../../../agents/lookAlike/lookalike.agent";
import { runIcpRefinementAgent } from "../icp.refinementAgent";
import { ingestLeadSignal } from "../signal-ingestion.agent";
import { runLeadAgent } from "../lead-agent.agent";

import { runEmailSequenceAgent } from "../email-sequence.agent";

const policy = QUEUE_POLICY.realtime;

async function processJob(job: import("bullmq").Job) {
  const log = logger.child({ jobId: job.id, jobName: job.name, correlationId: job.data?.correlationId });

  switch (job.name) {
    case "run-email-sequence": {
      const { campaignId } = job.data as { campaignId: string };
      log.info({ campaignId }, "[realtime.worker] run-email-sequence start");
      const result = await runEmailSequenceAgent(campaignId);
      return { campaignId, ...result };
    }
    case "process-reply-ai": {
      const { replyId } = job.data as { replyId: string };
      log.info({ replyId }, "[realtime.worker] process-reply-ai start");
      await processReplyAI(replyId);
      return { replyId };
    }

    case "run-followup": {
      const { campaignId } = job.data as { campaignId: string };
      log.info({ campaignId }, "[realtime.worker] run-followup start");
      await runFollowUpAgent(campaignId);
      return { campaignId };
    }

    case "handle-objections": {
      const { campaignId } = job.data as { campaignId: string };
      log.info({ campaignId }, "[realtime.worker] handle-objections start");
      await runObjectionHandlerForCampaign(campaignId);
      return { campaignId };
    }

    case "run-lookalike": {
      const { campaignId, triggeredBy, clientUrls, competitorTechUids } = job.data as {
        campaignId: string;
        triggeredBy: string;
        clientUrls: string[];
        competitorTechUids?: string[];
      };
      log.info({ campaignId }, "[realtime.worker] run-lookalike start");
      await runLookalikeAgent({ campaignId, userId: triggeredBy, clientUrls, competitorTechUids });
      return { campaignId };
    }

    case "run-icp-refinement": {
      const { campaignId } = job.data as { campaignId: string };
      log.info({ campaignId }, "[realtime.worker] run-icp-refinement start");
      await runIcpRefinementAgent(campaignId);
      return { campaignId };
    }

    case "ingest-lead-signal": {
      const { leadId, signalType, value, confidence, source } = job.data as {
        leadId: string;
        signalType: string;
        value: string;
        confidence: number;
        source?: string;
      };
      log.info({ leadId, signalType }, "[realtime.worker] ingest-lead-signal start");
      await ingestLeadSignal({ leadId, signalType, value, confidence, source });
      return { leadId, signalType };
    }

    case "run-lead-agent": {
      const { runId } = job.data as { runId: string };
      log.info({ runId }, "[realtime.worker] run-lead-agent start");
      await runLeadAgent(runId);
      return { runId };
    }

    default:
      throw new Error(`[realtime.worker] Unknown job type: ${job.name}`);
  }
}

export const realtimeWorker = new Worker(policy.queueName, processJob, {
  connection: createRedisConnection(),
  concurrency: policy.concurrency,
  lockDuration: policy.lockDuration,
});

wireWorkerEvents(realtimeWorker, policy.queueName);
