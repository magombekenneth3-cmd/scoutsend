import dotenv from "dotenv";
import path from "path";

dotenv.config({
  path: path.resolve(process.cwd(), ".env"),
});

const REQUIRED_ENV = [
  "JWT_SECRET",
  "DATABASE_URL",
  "APP_URL",
  "INTERNAL_API_URL",
  "GEMINI_API_KEY",
  "REDIS_URL",
  "ALLOWED_ORIGIN",
  "SYSTEM_SMTP_HOST",
  "SYSTEM_SMTP_USER",
  "SYSTEM_SMTP_PASS",
  "MAILBOX_ENCRYPTION_KEY",
] as const;

const FEATURE_ENV = [
  "APOLLO_API_KEYS",
  "SERPER_API_KEYS",
  "GOOGLE_PLACES_API_KEYS",
  "STRIPE_WEBHOOK_SECRET",
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
import helmet from "helmet";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import authRoutes from "./modules/auth/auth.routes";
import leadsRoutes from "./modules/leads/leads.routes";
import campaignsRoutes from "./modules/campaigns/campaigns.routes";
import { errorHandler } from "./modules/messages/Error.handler";
import outreachMessagesRoutes from "./modules/messages/message.routes";
import repliesRoutes from "./modules/replies/replies.routes";
import senderDomainsRoutes from "./modules/senderDomain/senderDomain.routes";
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
import calendarRoutes from "./modules/calendar/calendar.routes";
import authVerifyRoute from "./modules/auth/auth.verify.route";
import usersRoutes from "./modules/users/users.routes";
import dashboardRoutes from "./modules/dashboard/dashboard.routes";
import campaignEventsRoutes from "./modules/campaigns/campaigns.events.routes";
import adminRoutes from "./modules/admin/admin.routes";
import leadAgentRoutes from "./modules/lead-agent/lead-agent.routes";
import auditRoutes from "./modules/audit/audit.routes";
import organizationsRoutes from "./modules/organizations/organizations.routes";
import notificationsRoutes from "./modules/notifications/notifications.routes";
import billingRoutes from "./modules/billing/billing.routes";
import consentsRoutes from "./modules/consents/consents.routes";
import crmRoutes from "./modules/crm/crm.routes";
import apiKeysRoutes from "./modules/api-keys/api-keys.routes";
import prospectingRoutes from "./modules/prospecting/prospecting.routes";
import { unsubscribeRouter } from "./routes/unsubscribe.routes";
import { csrfMiddleware } from "./middleware/csrf.middleware";

import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { redis } from "./lib/ioredis";
import { validateSecrets } from "./lib/secrets.validator";
import { isUnipileConfigured } from "./lib/unipile.guard";
import { startPostmasterWorker } from "./modules/Deliverybilityevents/postmaster.worker";
import { createNotification } from "./modules/notifications/notifications.service";
import { metricsHandler } from "./modules/system/metrics.service";
import { tracingMiddleware } from "./modules/system/tracing";


validateSecrets();

if (process.env.SENTRY_DSN) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require("@sentry/node") as { init: Function; captureException: Function };
    Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV ?? "production" });
    process.on("unhandledRejection", (reason) => Sentry.captureException(reason));
  } catch { }
}


function makeRedisStore() {
  return new RedisStore({
    sendCommand: (...args: string[]) => (redis.call as any)(...args) as any,
  });
}

const app = express();
app.set("trust proxy", 1);
app.use(tracingMiddleware);

app.get("/metrics", metricsHandler);

// ─── Security Headers ─────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false,
}));

app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN,
    credentials: true,
  })
);

app.use("/billing/webhook", express.raw({ type: "application/json" }));
// Inbound email webhooks may carry large HTML payloads
app.use("/webhooks", express.json({ limit: "5mb" }));
app.use("/webhook", (req, res) => {
  res.redirect(301, req.url.replace("/webhook", "/webhooks"));
});
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// ─── Request Timeout ──────────────────────────────────────────────────────────
const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS ?? "30000", 10);
app.use((req, res, next) => {
  res.setTimeout(REQUEST_TIMEOUT_MS, () => {
    if (!res.headersSent) {
      res.status(504).json({ error: "Request timed out" });
    }
  });
  next();
});

app.get("/health", async (req, res) => {
  const healthSecret = process.env.HEALTH_CHECK_SECRET;
  const incomingSecret = req.headers["x-health-secret"];
  const isInternal =
    healthSecret && incomingSecret === healthSecret;
  if (!isInternal) {
    let dbOk = false;
    let redisOk = false;
    try { await prisma.$queryRaw`SELECT 1`; dbOk = true; } catch { }
    try { await redis.ping(); redisOk = true; } catch { }
    const ok = dbOk && redisOk;
    return res.status(ok ? 200 : 503).json({
      ok,
      version: process.env.npm_package_version ?? "unknown",
    });
  }
  const checks: Record<string, boolean | number | string> = { db: false, redis: false };
  let degraded = false;

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = true;
  } catch { }

  try {
    const start = Date.now();
    await redis.ping();
    checks.redis = true;
    checks.redisLatencyMs = Date.now() - start;
  } catch { }

  try {
    const { campaignQueue: q } = await import("./modules/gemini/campaign.queue");
    const counts = await q.getJobCounts("waiting", "active", "failed");
    checks.queueWaiting = counts.waiting ?? 0;
    checks.queueActive = counts.active ?? 0;
    checks.queueFailed = counts.failed ?? 0;
    if ((counts.waiting ?? 0) > 500) degraded = true;
  } catch { checks.queue = "unavailable"; }

  const healthy = checks.db === true && checks.redis === true;
  res.status(healthy ? 200 : 503).json({
    ok: healthy,
    degraded,
    checks,
    version: process.env.npm_package_version ?? "unknown",
  });
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
const outreachLimiter = rateLimit({ windowMs: 60_000, max: 120, store: makeRedisStore(), standardHeaders: true, legacyHeaders: false });
const repliesLimiter = rateLimit({ windowMs: 60_000, max: 60, store: makeRedisStore(), standardHeaders: true, legacyHeaders: false });
const memoryLimiter = rateLimit({ windowMs: 60_000, max: 60, store: makeRedisStore() });
const dashboardLimiter = rateLimit({ windowMs: 60_000, max: 120, store: makeRedisStore() });
const adminLimiter = rateLimit({ windowMs: 60_000, max: 60, store: makeRedisStore() });
const apiKeysLimiter = rateLimit({ windowMs: 60_000, max: 30, store: makeRedisStore() });
const notificationsLimiter = rateLimit({ windowMs: 60_000, max: 120, store: makeRedisStore() });
const organizationsLimiter = rateLimit({ windowMs: 60_000, max: 60, store: makeRedisStore() });
const prospectingLimiter = rateLimit({ windowMs: 60_000, max: 6, store: makeRedisStore(), message: { error: "Prospecting rate limit exceeded — max 6 requests per minute" }, standardHeaders: true, legacyHeaders: false });
const lookalikeApiLimiter = rateLimit({ windowMs: 60_000, max: 10, store: makeRedisStore(), message: { error: "Lookalike rate limit exceeded — max 10 requests per minute" }, standardHeaders: true, legacyHeaders: false });
const userWebhookLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  message: { error: "Too many webhook requests" },
  standardHeaders: true,
  legacyHeaders: false,
  store: makeRedisStore(),
});

// ─── Versioned API Router ─────────────────────────────────────────────────────
// All application routes live here. Mounted at /v1 (canonical) and at /
// (legacy alias with Deprecation headers for backward compatibility).

const v1Router = express.Router();

v1Router.use(csrfMiddleware);

v1Router.use("/auth", authLimiter, authRoutes);
v1Router.use("/auth", authVerifyRoute);
v1Router.use("/leads", leadsLimiter, leadsRoutes);
v1Router.use("/campaigns", campaignsLimiter, campaignsRoutes);
v1Router.use("/campaigns", orchestrationRoutes);
v1Router.use("/campaigns", lookalikeApiLimiter, lookalikeRoutes);
v1Router.use("/campaigns", campaignEventsRoutes);
v1Router.use("/outreach-messages", outreachLimiter, outreachMessagesRoutes);
v1Router.use("/replies", repliesLimiter, repliesRoutes);
v1Router.use("/sender-domains", senderDomainsLimiter, senderDomainsRoutes);
v1Router.use("/sender-mailboxes", senderMailboxesLimiter, senderMailboxRoutes);
v1Router.use("/linkedin-accounts", linkedInAccountsLimiter, linkedInAccountRoutes);
v1Router.use("/calendar", calendarRoutes);
v1Router.use("/suppression", suppressionLimiter, suppressionRoutes);
v1Router.use("/queue", queueRoutes);
v1Router.use("/ai-traces", aiTraceRoutes);
v1Router.use("/learning-events", learningEventRoutes);
v1Router.use("/deliverability-events", deliverabilityEventRoutes);
v1Router.get("/deliverability-stats", authMiddleware, getCampaignDeliverabilityStatsHandler);
v1Router.use("/brand-settings", brandSettingsRoutes);
v1Router.use("/users", usersRoutes);
v1Router.use("/memory", memoryLimiter, memoryRoutes);
v1Router.use("/dashboard", dashboardLimiter, dashboardRoutes);
v1Router.use("/admin", adminLimiter, adminRoutes);
v1Router.use("/audit-logs", auditRoutes);
v1Router.use("/organizations", organizationsLimiter, organizationsRoutes);
v1Router.use("/notifications", notificationsLimiter, notificationsRoutes);
v1Router.use("/billing", billingRoutes);
v1Router.use("/consents", consentsRoutes);
v1Router.use("/crm", crmRoutes);
v1Router.use("/api-keys", apiKeysLimiter, apiKeysRoutes);
v1Router.use("/prospecting", prospectingLimiter, prospectingRoutes);
v1Router.use("/", leadAgentRoutes);

const SUNSET_DATE = "Sat, 01 Jan 2028 00:00:00 GMT";

app.use("/v1", v1Router);

app.use("/", (req, res, next) => {
  res.setHeader("Deprecation", "true");
  res.setHeader("Sunset", SUNSET_DATE);
  res.setHeader("Link", `</v1${req.path}>; rel="successor-version"`);
  next();
}, v1Router);

// ─── Unversioned routes (webhooks, unsubscribe) ───────────────────────────────
// These are called by third-party providers and mail clients — URLs are
// registered externally and cannot be changed without provider reconfiguration.
app.use("/webhooks", providerWebhookRouter);
app.use("/webhooks", userWebhookLimiter, userWebhookRouter);
app.use("/unsubscribe", unsubscribeRouter);


app.use(errorHandler);

const PORT = process.env.PORT || 8080;

const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, "API running");

  if (!isUnipileConfigured()) {
    logger.warn("[startup] Unipile credentials are missing or placeholder — LinkedIn features disabled");
    prisma.organization.findMany({ select: { id: true }, take: 5 }).then((orgs) => {
      for (const org of orgs) {
        createNotification(
          org.id,
          "LinkedIn integration not configured",
          "UNIPILE_API_KEY or UNIPILE_BASE_URL is missing or invalid. LinkedIn outreach and discovery are disabled until valid credentials are provided.",
          "WARNING"
        ).catch(() => { });
      }
    }).catch(() => { });

  }

  if (process.env.RUN_WORKERS_IN_PROCESS === "true") {
    import("./modules/webhook/delivery.worker");
    import("./modules/crm/crm-sync.worker");
    import("./modules/gemini/workers");
    import("../../../packages/queue/src/audit.worker");
    startPostmasterWorker();
    startCampaignScheduler().catch((err) => {
      logger.error({ err }, "[scheduler] Failed to start campaign scheduler");
    });
  }
});


process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "[process] Unhandled promise rejection");
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "[process] Uncaught exception — shutting down gracefully");
  server.close(() => process.exit(1));
  setTimeout(() => process.exit(1), 5_000).unref();
});