import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../auth/auth.types";
import * as SenderDomainsService from "./senderDomain.services";
import {
  createSenderDomainSchema,
  updateSenderDomainSchema,
  getSenderDomainsQuerySchema,
} from "./senderDomain.schema";

export async function createSenderDomain(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = createSenderDomainSchema.parse(req.body);
    const domain = await SenderDomainsService.createSenderDomain(data, req.user!.userId);
    res.status(201).json(domain);
  } catch (error) {
    next(error);
  }
}

export async function getSenderDomains(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const query = getSenderDomainsQuerySchema.parse(req.query);
    const result = await SenderDomainsService.getSenderDomains(query, req.user!.userId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getSenderDomainById(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const domain = await SenderDomainsService.getSenderDomainById(id, req.user!.userId);
    res.status(200).json(domain);
  } catch (error) {
    next(error);
  }
}

export async function updateSenderDomain(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const data = updateSenderDomainSchema.parse(req.body);
    const domain = await SenderDomainsService.updateSenderDomain(id, req.user!.userId, data);
    res.status(200).json(domain);
  } catch (error) {
    next(error);
  }
}

export async function deleteSenderDomain(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    await SenderDomainsService.deleteSenderDomain(id, req.user!.userId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function resetDailyCount(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const domain = await SenderDomainsService.resetDailyCount(id, req.user!.userId);
    res.status(200).json(domain);
  } catch (error) {
    next(error);
  }
}

export async function verifySenderDomainDns(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const result = await SenderDomainsService.verifySenderDomainDns(id, req.user!.userId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}