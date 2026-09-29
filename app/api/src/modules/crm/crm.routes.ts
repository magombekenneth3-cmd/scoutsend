import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { authMiddleware } from "../auth/auth.middleware";
import { prisma } from "../../lib/prisma";
import { AuthenticatedRequest } from "../auth/auth.types";
import { CrmProvider } from "@prisma/client";
import { encrypt } from "../../lib/mail/crypto";
import { logger } from "../../lib/logger";
import { HttpError } from "../../lib/errors/http-error";

const router = Router();
router.use(authMiddleware);

router.get("/status", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const orgId = req.user!.orgId;
    if (!orgId) {
        res.status(403).json({ error: "No organisation context" });
        return;
    }
    const integrations = await prisma.crmIntegration.findMany({
        where: { orgId },
        select: {
            id: true,
            provider: true,
            lastSyncAt: true,
            syncErrorCount: true,
            tokenExpiresAt: true,
            updatedAt: true,
        },
    });
    res.json({ integrations });
});

const connectSchema = z.object({
    provider: z.nativeEnum(CrmProvider),
    accessToken: z.string().min(1),
    refreshToken: z.string().optional(),
    tokenExpiresAt: z.string().datetime().optional(),
});

router.post("/connect", async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const orgId = req.user!.orgId;
    if (!orgId) {
        res.status(403).json({ error: "No organisation context" });
        return;
    }
    try {
        const data = connectSchema.parse(req.body);
        const encryptedAccess = encrypt(data.accessToken);
        const encryptedRefresh = data.refreshToken ? encrypt(data.refreshToken) : null;

        const integration = await prisma.crmIntegration.upsert({
            where: { orgId_provider: { orgId, provider: data.provider } },
            update: {
                accessToken: encryptedAccess,
                refreshToken: encryptedRefresh,
                tokenExpiresAt: data.tokenExpiresAt ? new Date(data.tokenExpiresAt) : null,
                syncErrorCount: 0,
            },
            create: {
                orgId,
                provider: data.provider,
                accessToken: encryptedAccess,
                refreshToken: encryptedRefresh,
                tokenExpiresAt: data.tokenExpiresAt ? new Date(data.tokenExpiresAt) : null,
            },
            select: { id: true, provider: true, tokenExpiresAt: true, updatedAt: true },
        });

        logger.info({ orgId, provider: data.provider }, "[crm] Integration connected");
        res.status(201).json(integration);
    } catch (err) {
        if (err instanceof z.ZodError) {
            res.status(400).json({ error: err.issues });
            return;
        }

        logger.error({ err }, "[crm] Failed to connect integration");
        next(new HttpError(
            503,
            String(err),
            "CRM_CONNECT_FAILED",
            "Unable to save your CRM integration. Please check your credentials in Settings and try again. If the problem persists, contact support."
        ));
    }
});

router.delete("/:provider", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const orgId = req.user!.orgId;
    if (!orgId) {
        res.status(403).json({ error: "No organisation context" });
        return;
    }
    const { provider } = z.object({ provider: z.nativeEnum(CrmProvider) }).parse(req.params);
    await prisma.crmIntegration.deleteMany({ where: { orgId, provider } });
    res.status(204).send();
});

export default router;
