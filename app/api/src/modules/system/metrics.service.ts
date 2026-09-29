import { Request, Response } from "express";
import client from "prom-client";
import {
  campaignQueue,
  sendQueue,
  realtimeQueue,
  maintenanceQueue,
  linkedinQueue,
  mailPollQueue,
  seedWarmupQueue,
  orchestratorQueue,
} from "../gemini/campaign.queue";
import { logger } from "../../lib/logger";

// Initialize Prometheus Default Metrics (CPU, Memory, Event Loop)
client.collectDefaultMetrics({ prefix: "scoutsend_" });

export const metricsRegistry = client.register;

// ── HTTP Metrics ─────────────────────────────────────────────────────────────

export const httpRequestCounter = new client.Counter({
  name: "scoutsend_http_requests_total",
  help: "Total number of HTTP requests processed",
  labelNames: ["method", "route", "status_code"],
});

export const httpRequestDurationHistogram = new client.Histogram({
  name: "scoutsend_http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

// ── BullMQ Metrics ────────────────────────────────────────────────────────────

export const bullmqQueueJobsGauge = new client.Gauge({
  name: "scoutsend_bullmq_queue_jobs",
  help: "Number of BullMQ jobs in queue by state",
  labelNames: ["queue", "status"],
});

// ── AI Metrics ────────────────────────────────────────────────────────────────

export const llmTokenUsageCounter = new client.Counter({
  name: "scoutsend_llm_tokens_total",
  help: "Total LLM tokens consumed",
  labelNames: ["agent", "model"],
});

export const llmCostCounter = new client.Counter({
  name: "scoutsend_llm_cost_usd_total",
  help: "Total LLM API spend in USD",
  labelNames: ["agent", "model"],
});

// ── Queue Metrics Collector ───────────────────────────────────────────────────

const ALL_QUEUES = [
  { name: "campaign", queue: campaignQueue },
  { name: "send", queue: sendQueue },
  { name: "realtime", queue: realtimeQueue },
  { name: "maintenance", queue: maintenanceQueue },
  { name: "linkedin", queue: linkedinQueue },
  { name: "mailPoll", queue: mailPollQueue },
  { name: "seedWarmup", queue: seedWarmupQueue },
  { name: "orchestrator", queue: orchestratorQueue },
];

export async function collectQueueMetrics(): Promise<void> {
  for (const { name, queue } of ALL_QUEUES) {
    if (!queue) continue;
    try {
      const counts = await queue.getJobCounts(
        "waiting",
        "active",
        "completed",
        "failed",
        "delayed",
        "paused"
      );

      bullmqQueueJobsGauge.set({ queue: name, status: "waiting" }, counts.waiting ?? 0);
      bullmqQueueJobsGauge.set({ queue: name, status: "active" }, counts.active ?? 0);
      bullmqQueueJobsGauge.set({ queue: name, status: "completed" }, counts.completed ?? 0);
      bullmqQueueJobsGauge.set({ queue: name, status: "failed" }, counts.failed ?? 0);
      bullmqQueueJobsGauge.set({ queue: name, status: "delayed" }, counts.delayed ?? 0);
      bullmqQueueJobsGauge.set({ queue: name, status: "paused" }, counts.paused ?? 0);
    } catch (err) {
      logger.error({ queue: name, err }, "[metrics] Failed to collect BullMQ queue counts");
    }
  }
}

export async function metricsHandler(req: Request, res: Response): Promise<void> {
  try {
    await collectQueueMetrics();
    res.setHeader("Content-Type", client.register.contentType);
    res.send(await client.register.metrics());
  } catch (err) {
    logger.error({ err }, "[metrics] Failed to render Prometheus metrics");
    res.status(500).send("Error rendering metrics");
  }
}
