import { cookies } from "next/headers";
import Jwt from "jsonwebtoken";
import { redis } from "./ioredis";
import { prisma } from "./prisma";

interface SessionPayload {
    userId: string;
}

type AccessTokenPayload = {
    userId: string;
    jti: string;
    tokenVersion: number;
};

export async function getServerSession(): Promise<SessionPayload | null> {
    try {
        const store = await cookies();
        const token = store.get("token")?.value;
        if (!token) return null;

        const JWT_SECRET = process.env.JWT_SECRET;
        if (!JWT_SECRET) return null;

        const decoded = Jwt.verify(token, JWT_SECRET) as AccessTokenPayload;
        if (!decoded?.userId || !decoded.jti) return null;

        const blacklisted = await redis.get(`auth:blacklist:${decoded.jti}`).catch(() => null);
        if (blacklisted) return null;

        const user = await prisma.user.findUnique({
            where: { id: decoded.userId },
            select: { tokenVersion: true },
        });
        if (!user || user.tokenVersion !== decoded.tokenVersion) return null;

        return { userId: decoded.userId };
    } catch {
        return null;
    }
}
