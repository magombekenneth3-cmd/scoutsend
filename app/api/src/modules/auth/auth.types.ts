import { Request } from "express";

export interface JwtPayload {
  userId: string;
  email: string;
  jti: string;
  tokenVersion: number;
  role: string;
}

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}