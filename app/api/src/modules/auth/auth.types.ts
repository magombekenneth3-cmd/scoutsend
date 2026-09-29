import { Request } from "express";
import type { forTenant } from "../../lib/prisma-tenant";

export interface JwtPayload {
  userId: string;
  email: string;
  jti: string;
  tokenVersion: number;
  role: string;
  orgId?: string;
  orgRole?: string;
  emailVerified?: boolean;
}

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
  tenantDb?: ReturnType<typeof forTenant>;
}