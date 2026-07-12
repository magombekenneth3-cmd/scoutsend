import { Router, Response } from "express";
import { authMiddleware } from "../auth/auth.middleware";
import { AuthenticatedRequest } from "../auth/auth.types";
import { campaignEventBus, CampaignEvent } from "../../lib/campaign-events";

const router = Router();

router.use(authMiddleware);

router.get("/events", (req: AuthenticatedRequest, res: Response) => {
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

    req.on("close", () => {
        clearInterval(heartbeat);
        campaignEventBus.off("campaign-event", handler);
    });
});

export default router;
