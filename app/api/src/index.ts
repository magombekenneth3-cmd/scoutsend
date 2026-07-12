import dotenv from "dotenv";
import path from "path";

dotenv.config({
  path: path.resolve(process.cwd(), ".env"),
});

const REQUIRED_ENV = [
  "JWT_SECRET",
  "DATABASE_URL",
  "WEBHOOK_SECRET",
  "APP_URL",
  "INTERNAL_API_URL",
  "GEMINI_API_KEY",
  "REDIS_URL",
  "ALLOWED_ORIGIN",
  "SYSTEM_SMTP_HOST",
  "SYSTEM_SMTP_USER",
  "SYSTEM_SMTP_PASS",
  "MAILBOX_ENCRYPTION_KEY",
  "UNIPILE_BASE_URL",
  "UNIPILE_API_KEY",
] as const;

const FEATURE_ENV = [
  "APOLLO_API_KEYS",
  "SERPER_API_KEYS",
  "GOOGLE_PLACES_API_KEYS",
] as const;

const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
  console.error(
    `[startup] Missing required environment variables: ${missingEnv.join(", ")}\nSet them in your .env file and restart.`
  );
  process.exit(1);
}

const missingFeatureEnv = FEATURE_ENV.filter((key) => !process.env[key]);
if (missingFeatureEnv.length > 0) {
  console.warn(
    `[startup] Feature API keys not configured (enrichment/search will be disabled): ${missingFeatureEnv.join(", ")}`
  );
}


import rateLimit from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import authRoutes from "./modules/auth/auth.routes";
import leadsRoutes from "./modules/leads/leads.routes";
import campaignsRoutes from "./modules/campaigns/campaigns.routes";
import { errorHandler } from "./modules/messages/Error.handler";
import outreachMessagesRoutes from "./modules/messages/message.routes";
import repliesRoutes from "./modules/replies/replies.routes";
import senderDomainsRoutes from "./modules/senderDomain/senderDomian.routes";
import suppressionRoutes from "./modules/suppression/suppression.routes";
import queueRoutes from "./modules/queue/queue.routes";
import aiTraceRoutes from "./modules/AItrace/aitrace.routes";
import memoryRoutes from "./modules/memory/Memory.routes";
import orchestrationRoutes from "./modules/gemini/orchestration.routes";
import lookalikeRoutes from "./modules/lookalike/lookalike.routes";
import learningEventRoutes from "./modules/learning/learning.routes";
import deliverabilityEventRoutes from "./modules/Deliverybilityevents/deliverbility.routes";
import { getCampaignDeliverabilityStatsHandler } from "./modules/Deliverybilityevents/deliverbility.controller";
import { authMiddleware } from "./modules/auth/auth.middleware";
import { startCampaignScheduler } from "./modules/gemini/campaign.scheduler";
import brandSettingsRoutes from "./modules/brandSettings/brandsetting.routes";
import senderMailboxRoutes from "./modules/senderMailbox/senderMailbox.routes";
import linkedInAccountRoutes from "./modules/linkedInAccount/linkedInAccount.routes";
import { providerWebhookRouter, userWebhookRouter } from "./modules/webhook/webhooks.routes";
import "./modules/webhook/delivery.worker";
import calendarRoutes from "./modules/calendar/calendar.routes";
import authVerifyRoute from "./modules/auth/auth.verify.route";
import usersRoutes from "./modules/users/users.routes";
import dashboardRoutes from "./modules/dashboard/dashboard.routes";
import campaignEventsRoutes from "./modules/campaigns/campaigns.events.routes";
import adminRoutes from "./modules/admin/admin.routes";
import leadAgentRoutes from "./modules/lead-agent/lead-agent.routes";
import auditRoutes from "./modules/audit/audit.routes";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { redis } from "./lib/ioredis";
import "./modules/gemini/workers";
import "../../../packages/queue/src/audit.worker";

function makeRedisStore() {
  return new RedisStore({
    sendCommand: (...args: string[]) => (redis.call as any)(...args) as any,
  });
}

const app = express();
app.set("trust proxy", 1);

app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN,
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.get("/health", async (_, res) => {
  const checks = { db: false, redis: false };
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = true;
  } catch { }
  try {
    await redis.ping();
    checks.redis = true;
  } catch { }
  const healthy = checks.db && checks.redis;
  res.status(healthy ? 200 : 503).json({ ok: healthy, checks });
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
  store: makeRedisStore(),
  skip: (req) => req.method === "GET",
});

const suppressionLimiter = rateLimit({ windowMs: 60_000, max: 60, store: makeRedisStore() });
const senderDomainsLimiter = rateLimit({ windowMs: 60_000, max: 300, store: makeRedisStore() });
const senderMailboxesLimiter = rateLimit({ windowMs: 60_000, max: 300, store: makeRedisStore() });
const linkedInAccountsLimiter = rateLimit({ windowMs: 60_000, max: 300, store: makeRedisStore() });
const campaignsLimiter = rateLimit({ windowMs: 60_000, max: 120, store: makeRedisStore() });
const leadsLimiter = rateLimit({ windowMs: 60_000, max: 120, store: makeRedisStore() });
const userWebhookLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  message: { error: "Too many webhook requests" },
  standardHeaders: true,
  legacyHeaders: false,
  store: makeRedisStore(),
});

app.use("/auth", authLimiter, authRoutes);
app.use("/auth", authVerifyRoute);
app.use("/leads", leadsLimiter, leadsRoutes);
app.use("/campaigns", campaignsLimiter, campaignsRoutes);
app.use("/campaigns", orchestrationRoutes);
app.use("/campaigns", lookalikeRoutes);
app.use("/outreach-messages", outreachMessagesRoutes);
app.use("/replies", repliesRoutes);
app.use("/sender-domains", senderDomainsLimiter, senderDomainsRoutes);
app.use("/sender-mailboxes", senderMailboxesLimiter, senderMailboxRoutes);
app.use("/linkedin-accounts", linkedInAccountsLimiter, linkedInAccountRoutes);
app.use("/calendar", calendarRoutes);
app.use("/suppression", suppressionLimiter, suppressionRoutes);
app.use("/queue", queueRoutes);
app.use("/ai-traces", aiTraceRoutes);
app.use("/learning-events", learningEventRoutes);
app.use("/deliverability-events", deliverabilityEventRoutes);
app.get("/deliverability-stats", authMiddleware, getCampaignDeliverabilityStatsHandler);
app.use("/brand-settings", brandSettingsRoutes);
app.use("/webhooks", providerWebhookRouter);
app.use("/webhook", providerWebhookRouter);
app.use("/webhooks", userWebhookLimiter, userWebhookRouter);
app.use("/webhook", userWebhookLimiter, userWebhookRouter);
app.use("/users", usersRoutes);
app.use("/memory", memoryRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/campaigns", campaignEventsRoutes);
app.use("/admin", adminRoutes);
app.use("/audit-logs", auditRoutes);
app.use("/", leadAgentRoutes);

app.use(errorHandler);

const PORT = process.env.PORT || 8080;

const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, "API running");
  startCampaignScheduler().catch((err) => {
    logger.error({ err }, "[scheduler] Failed to start campaign scheduler");
    process.exit(1);
  });
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "[process] Unhandled promise rejection");
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "[process] Uncaught exception — shutting down gracefully");
  server.close(() => process.exit(1));
  setTimeout(() => process.exit(1), 5_000).unref();
});