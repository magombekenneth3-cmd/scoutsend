import { Router, Response } from "express";
import { authMiddleware } from "../auth/auth.middleware";
import { AuthenticatedRequest } from "../auth/auth.types";
import { campaignEventBus, CampaignEvent } from "../../lib/campaign-events";

const router = Router();

router.use(authMiddleware);

interface SseConnection {
  res: Response;
  heartbeat: NodeJS.Timeout;
  handler: (event: CampaignEvent) => void;
}

const activeConnections = new Map<string, SseConnection>();

router.get("/events", (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;

  const existing = activeConnections.get(userId);
  if (existing) {
    clearInterval(existing.heartbeat);
    campaignEventBus.off("campaign-event", existing.handler);
    activeConnections.delete(userId);
    existing.res.end();
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  res.write(":\n\n");

  const heartbeat = setInterval(() => {
    res.write(":\n\n");
  }, 25_000);

  const handler = (event: CampaignEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  campaignEventBus.on("campaign-event", handler);
  activeConnections.set(userId, { res, heartbeat, handler });

  req.on("close", () => {
    clearInterval(heartbeat);
    campaignEventBus.off("campaign-event", handler);
    if (activeConnections.get(userId)?.res === res) {
      activeConnections.delete(userId);
    }
  });
});

export default router;
