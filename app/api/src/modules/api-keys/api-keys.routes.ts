import { Router, Response, NextFunction, Request } from "express";
import { z } from "zod";
import { authMiddleware } from "../auth/auth.middleware";
import { AuthenticatedRequest } from "../auth/auth.types";
import { createApiKey, listApiKeys, revokeApiKey } from "./api-keys.service";
import { logAudit } from "../audit/audit.service";
import { AUDIT_EVENTS } from "../../lib/constants";

function getIp(req: Request): string | undefined {
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) return (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(",")[0].trim();
    return req.socket?.remoteAddress;
}

function getUserAgent(req: Request): string | undefined {
    const ua = req.headers["user-agent"];
    return Array.isArray(ua) ? ua[0] : ua;
}


const router = Router();

const createSchema = z.object({
    name: z.string().min(1).max(80),
    scopes: z.array(z.string().min(1)).min(1).default(["inbound:lead"]),
});

router.use(authMiddleware);

router.get("/", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        if (!req.user!.orgId) { res.status(403).json({ error: "No organization" }); return; }
        const keys = await listApiKeys(req.user!.orgId);
        res.json({ data: keys });
    } catch (err) { next(err); }
});

router.post("/", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        if (!req.user!.orgId) { res.status(403).json({ error: "No organization" }); return; }
        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }

        const result = await createApiKey(req.user!.orgId, parsed.data.name, parsed.data.scopes);

        await logAudit({
            userId: req.user!.userId,
            action: AUDIT_EVENTS.API_KEY_CREATED,
            entityType: "ApiKey",
            entityId: result.id,
            metadata: { name: result.name, scopes: result.scopes, prefix: result.keyPrefix },
            ipAddress: getIp(req),
            userAgent: getUserAgent(req),
        });

        res.status(201).json(result);
    } catch (err) { next(err); }
});

router.delete("/:id", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        if (!req.user!.orgId) { res.status(403).json({ error: "No organization" }); return; }
        const keyId = String(req.params.id);
        const orgId = String(req.user!.orgId);
        await revokeApiKey(keyId, orgId);

        await logAudit({
            userId: req.user!.userId,
            action: AUDIT_EVENTS.API_KEY_REVOKED,
            entityType: "ApiKey",
            entityId: keyId,
            ipAddress: getIp(req),
            userAgent: getUserAgent(req),
        });

        res.status(204).send();
    } catch (err) { next(err); }
});

export default router;
