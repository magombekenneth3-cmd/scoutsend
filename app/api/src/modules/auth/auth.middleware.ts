import { NextFunction, Response } from "express";
import Jwt from "jsonwebtoken";
import { AuthenticatedRequest, JwtPayload } from "./auth.types";
import { isTokenBlacklisted } from "./auth.service";
import { prisma } from "../../lib/prisma";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("[authMiddleware] JWT_SECRET environment variable is not set");

export const authMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    let token: string | undefined;
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    } else if (req.cookies?.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return res.status(401).json({ error: "Authorization header missing or malformed" });
    }

    const decoded = Jwt.verify(token, JWT_SECRET) as JwtPayload & { jti?: string };

    if (!decoded.jti) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const [blacklisted, user] = await Promise.all([
      isTokenBlacklisted(decoded.jti),
      prisma.user.findUnique({
        where: { id: decoded.userId },
        select: { tokenVersion: true },
      }),
    ]);

    if (blacklisted) {
      return res.status(401).json({ error: "Token has been revoked" });
    }

    if (!user || user.tokenVersion !== decoded.tokenVersion) {
      return res.status(401).json({ error: "Session expired, please log in again" });
    }

    req.user = decoded;
    next();
  } catch (error) {
    if (error instanceof Jwt.TokenExpiredError) {
      return res.status(401).json({ error: "Token expired" });
    }
    return res.status(401).json({ error: "Invalid token" });
  }
};