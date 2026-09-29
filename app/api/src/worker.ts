import dotenv from "dotenv";
import path from "path";

dotenv.config({
  path: path.resolve(process.cwd(), ".env"),
});

import { logger } from "./lib/logger";
import { validateSecrets } from "./lib/secrets.validator";
import { startPostmasterWorker } from "./modules/Deliverybilityevents/postmaster.worker";
import { startCampaignScheduler } from "./modules/gemini/campaign.scheduler";

import "./modules/webhook/delivery.worker";
import "./modules/crm/crm-sync.worker";
import "./modules/gemini/workers";
import "../../../packages/queue/src/audit.worker";

validateSecrets();

startPostmasterWorker();

startCampaignScheduler().catch((err) => {
  logger.error({ err }, "[worker] Failed to start campaign scheduler — will retry in 30s");
  setTimeout(() => {
    startCampaignScheduler().catch((retryErr) => {
      logger.error({ retryErr }, "[worker] Campaign scheduler retry failed — scheduler disabled, other workers continue");
    });
  }, 30_000);
});

logger.info("[worker] Standalone BullMQ worker process initialized");

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "[worker] Unhandled promise rejection");
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "[worker] Uncaught exception");
  process.exit(1);
});
