import { Response, NextFunction } from "express";
import { z } from "zod";
import { AuthenticatedRequest } from "../auth/auth.types";
import * as ConsentService from "./consents.service";
import { ConsentBasis } from "@prisma/client";

const recordSchema = z.object({
    email: z.string().email(),
    domain: z.string().optional(),
    basis: z.nativeEnum(ConsentBasis),
    source: z.string().min(1),
});

export async function recordConsentHandler(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const orgId = req.user!.orgId;
        if (!orgId) {
            res.status(403).json({ error: "No organisation context" });
            return;
        }
        const data = recordSchema.parse(req.body);
        const record = await ConsentService.recordConsent({
            orgId,
            email: data.email,
            domain: data.domain,
            basis: data.basis,
            source: data.source,
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"],
        });
        res.status(201).json(record);
    } catch (err) {
        next(err);
    }
}

export async function revokeConsentHandler(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const orgId = req.user!.orgId;
        if (!orgId) {
            res.status(403).json({ error: "No organisation context" });
            return;
        }
        const { email } = z.object({ email: z.string().email() }).parse(req.params);
        await ConsentService.revokeConsent(orgId, email);
        res.status(204).send();
    } catch (err) {
        next(err);
    }
}

export async function listConsentsHandler(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const orgId = req.user!.orgId;
        if (!orgId) {
            res.status(403).json({ error: "No organisation context" });
            return;
        }
        const { page, limit } = z
            .object({
                page: z.coerce.number().int().min(1).default(1),
                limit: z.coerce.number().int().min(1).max(200).default(50),
            })
            .parse(req.query);
        const result = await ConsentService.listConsents(orgId, page, limit);
        res.json(result);
    } catch (err) {
        next(err);
    }
}
