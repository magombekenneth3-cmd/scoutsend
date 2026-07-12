import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../auth/auth.types";
import * as LinkedInAccountService from "./linkedInAccount.services";
import {
    connectLinkedInAccountSchema,
    getLinkedInAccountsQuerySchema,
} from "./linkedInAccount.schema";

export async function connectLinkedInAccount(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const data = connectLinkedInAccountSchema.parse(req.body);
        const account = await LinkedInAccountService.connectLinkedInAccount(data, req.user!.userId);
        res.status(200).json(account);
    } catch (error) {
        next(error);
    }
}

export async function getLinkedInAccounts(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const query = getLinkedInAccountsQuerySchema.parse(req.query);
        const result = await LinkedInAccountService.getLinkedInAccounts(query, req.user!.userId);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
}

export async function getLinkedInAccountById(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { id } = req.params as { id: string };
        const account = await LinkedInAccountService.getLinkedInAccountById(id, req.user!.userId);
        if (!account) {
            res.status(404).json({ error: "LinkedIn account not found" });
            return;
        }
        res.status(200).json(account);
    } catch (error) {
        next(error);
    }
}

export async function deleteLinkedInAccount(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { id } = req.params as { id: string };
        await LinkedInAccountService.deleteLinkedInAccount(id, req.user!.userId);
        res.status(204).send();
    } catch (error) {
        next(error);
    }
}

export async function getConnectUrl(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const result = await LinkedInAccountService.getUnipileConnectUrl(req.user!.userId);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
}

export async function syncAccounts(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const result = await LinkedInAccountService.syncUnipileAccounts(req.user!.userId);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
}
