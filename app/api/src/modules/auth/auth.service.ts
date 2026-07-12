import z from "zod";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import { prisma } from "../../lib/prisma";
import { redis } from "../../lib/ioredis";
import { loginSchema, registerSchema, forgotPasswordSchema, resetPasswordSchema } from "./auth.schema";
import { logAudit } from "../audit/audit.service";

type AuthContext = {
    ipAddress?: string;
    userAgent?: string;
};

if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET environment variable is not set");
}
const JWT_SECRET = process.env.JWT_SECRET;

const DUMMY_HASH = bcrypt.hashSync("dummy-for-timing-protection", 12);

export class AppError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number
    ) {
        super(message);
        this.name = "AppError";
    }
}

function tokenBlacklistKey(jti: string) {
    return `auth:blacklist:${jti}`;
}

function passwordResetKey(token: string) {
    return `auth:reset:${token}`;
}

function getSystemMailer() {
    return nodemailer.createTransport({
        host: process.env.SYSTEM_SMTP_HOST!,
        port: parseInt(process.env.SYSTEM_SMTP_PORT || "587", 10),
        secure: process.env.SYSTEM_SMTP_SECURE === "true",
        auth: {
            user: process.env.SYSTEM_SMTP_USER!,
            pass: process.env.SYSTEM_SMTP_PASS!,
        },
    });
}

export async function registerUser(data: z.infer<typeof registerSchema>) {
    const { email, password, firstName, lastName } = data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
        throw new AppError("Email already in use", 409);
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
        data: { email, passwordHash, firstName, lastName },
        select: { id: true, email: true, firstName: true, lastName: true, role: true, tokenVersion: true },
    });

    const jti = crypto.randomUUID();
    const token = jwt.sign({ userId: user.id, email: user.email, role: user.role, jti, tokenVersion: user.tokenVersion }, JWT_SECRET, {
        expiresIn: "7d",
    });

    return { user, token };
}

export async function loginUser(data: z.infer<typeof loginSchema>, ctx: AuthContext) {
    const { email, password } = data;

    const user = await prisma.user.findUnique({
        where: { email },
        select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            passwordHash: true,
            tokenVersion: true,
        },
    });

    if (!user) {
        await bcrypt.compare(password, DUMMY_HASH);
        throw new AppError("Invalid email or password", 401);
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
        try {
            await logAudit({
                userId: user.id,
                action: "USER LOGIN_FAILED",
                entityId: user.id,
                entityType: "USER",
                ipAddress: ctx.ipAddress,
                userAgent: ctx.userAgent,
                metadata: { email: user.email, reason: "invalid_password" },
            })

        } catch (error) {
            console.error("[audit] failed to log USER_LOGIN_FAILED:", error);
        }
        throw new AppError("Invalid email or password", 401);
    }

    const jti = crypto.randomUUID();
    const token = jwt.sign({ userId: user.id, email: user.email, role: user.role, jti, tokenVersion: user.tokenVersion }, JWT_SECRET, {
        expiresIn: "7d",
    });

    const { passwordHash: _, ...safeUser } = user;
    return { user: safeUser, token };
}

export async function getMe(userId: string) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            createdAt: true,
        },
    });

    if (!user) {
        throw new AppError("User not found", 404);
    }

    return user;
}

export async function logoutUser(token: string, ctx: AuthContext): Promise<{ blacklisted: boolean }> {
    let decoded: jwt.JwtPayload & { userId: string; email: string };

    try {
        decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload & { userId: string; email: string };
    } catch {
        return { blacklisted: false };
    }

    const jti = decoded.jti;
    const exp = decoded.exp;

    if (!jti || !exp) {
        return { blacklisted: false };
    }

    const ttlSeconds = exp - Math.floor(Date.now() / 1000);
    if (ttlSeconds > 0) {
        await redis.set(tokenBlacklistKey(jti), "1", "EX", ttlSeconds);
        try {
            await logAudit({
                userId: decoded.userId,
                action: "USER LOGOUT",
                entityId: decoded.userId,
                entityType: "USER",
                ipAddress: ctx.ipAddress,
                userAgent: ctx.userAgent,
            })
        } catch (error) {
            console.error("[audit] failed to log USER_LOGOUT:", error);
        }
        return { blacklisted: true };
    }

    return { blacklisted: false };
}

export async function isTokenBlacklisted(jti: string): Promise<boolean> {
    const result = await redis.get(tokenBlacklistKey(jti));
    return result !== null;
}

export async function forgotPassword(data: z.infer<typeof forgotPasswordSchema>) {
    const user = await prisma.user.findUnique({
        where: { email: data.email },
        select: { id: true, email: true, firstName: true },
    });

    if (!user) {
        return;
    }

    const resetToken = crypto.randomUUID();
    await redis.set(passwordResetKey(resetToken), user.id, "EX", 60 * 60);

    const resetUrl = `${process.env.APP_URL}/auth/reset-password?token=${resetToken}`;

    const from = process.env.SYSTEM_SMTP_FROM || process.env.SYSTEM_SMTP_USER!;

    const mailer = getSystemMailer();
    await mailer.sendMail({
        from,
        to: user.email,
        subject: "Reset your password",
        html: `<p>Hi ${user.firstName},</p>
<p>Click the link below to reset your password. It expires in 1 hour.</p>
<p><a href="${resetUrl}">${resetUrl}</a></p>
<p>If you did not request a password reset, ignore this email.</p>`,
        text: `Hi ${user.firstName},\n\nReset your password here: ${resetUrl}\n\nThis link expires in 1 hour. If you did not request this, ignore this email.`,
    });
}

export async function resetPassword(data: z.infer<typeof resetPasswordSchema>) {
    const userId = await redis.get(passwordResetKey(data.token));

    if (!userId) {
        throw new AppError("Invalid or expired reset token", 400);
    }

    const passwordHash = await bcrypt.hash(data.password, 12);

    await prisma.user.update({
        where: { id: userId },
        data: { passwordHash, tokenVersion: { increment: 1 } },

    });

    await redis.del(passwordResetKey(data.token));
}