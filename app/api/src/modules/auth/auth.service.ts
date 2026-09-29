import z from "zod";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { redis } from "../../lib/ioredis";
import { loginSchema, registerSchema, forgotPasswordSchema, resetPasswordSchema } from "./auth.schema";
import { logAudit } from "../audit/audit.service";
import { logger } from "../../lib/logger";
import { AppError } from "../../lib/errors";

type AuthContext = {
    ipAddress?: string;
    userAgent?: string;
};

if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET environment variable is not set");
}
const JWT_SECRET = process.env.JWT_SECRET;

const DUMMY_HASH = bcrypt.hashSync("dummy-for-timing-protection", 12);

function generateOrgSlug(name: string): string {
    return name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 48);
}

async function ensureUniqueSlug(
    tx: Prisma.TransactionClient,
    base: string,
): Promise<string> {
    let slug = base || "workspace";
    let suffix = 0;
    while (true) {
        const candidate = suffix === 0 ? slug : `${slug}-${suffix}`;
        const exists = await tx.organization.findUnique({ where: { slug: candidate }, select: { id: true } });
        if (!exists) return candidate;
        suffix++;
    }
}

// AppError is imported from ../../lib/errors
// Re-export for backward compatibility if anything depends on it
export { AppError };

function tokenBlacklistKey(jti: string) {
    return `auth:blacklist:${jti}`;
}

function passwordResetKey(token: string) {
    return `auth:reset:${token}`;
}

function emailVerificationKey(token: string) {
    return `auth:verify:${token}`;
}

function refreshTokenKey(jti: string) {
    return `auth:refresh:${jti}`;
}

const LOGIN_ATTEMPT_LIMIT = 10;
const LOGIN_LOCKOUT_SECONDS = 15 * 60;

function loginAttemptKey(email: string): string {
    return `auth:login_attempts:${email.toLowerCase()}`;
}

async function checkLoginLockout(email: string): Promise<void> {
    try {
        const count = await redis.get(loginAttemptKey(email));
        if (count && parseInt(count, 10) >= LOGIN_ATTEMPT_LIMIT) {
            throw new AppError("Too many failed login attempts. Try again in 15 minutes.", 429);
        }
    } catch (err) {
        if (err instanceof AppError) throw err;
        logger.warn({ err, email }, "[auth.service] Redis error in checkLoginLockout — failing open");
    }
}

async function recordFailedLogin(email: string): Promise<void> {
    try {
        const key = loginAttemptKey(email);
        const count = await redis.incr(key);
        if (count === 1) await redis.expire(key, LOGIN_LOCKOUT_SECONDS);
    } catch (err) {
        logger.warn({ err, email }, "[auth.service] Redis error in recordFailedLogin");
    }
}

async function clearFailedLogins(email: string): Promise<void> {
    try {
        await redis.del(loginAttemptKey(email));
    } catch (err) {
        logger.warn({ err, email }, "[auth.service] Redis error in clearFailedLogins");
    }
}

export interface TokenPairOptions {
    userId: string;
    email: string;
    role: string;
    tokenVersion: number;
    orgId?: string | null;
    orgRole?: string | null;
    emailVerified?: boolean;
    familyId?: string;
}

export async function issueTokenPair(options: TokenPairOptions) {
    const accessJti = crypto.randomUUID();
    const refreshJti = crypto.randomUUID();
    const familyId = options.familyId || crypto.randomUUID();

    const accessToken = jwt.sign(
        {
            userId: options.userId,
            email: options.email,
            role: options.role,
            jti: accessJti,
            tokenVersion: options.tokenVersion,
            orgId: options.orgId ?? undefined,
            orgRole: options.orgRole ?? undefined,
            emailVerified: options.emailVerified ?? true,
        },
        JWT_SECRET,
        { expiresIn: "15m" }
    );

    const refreshToken = jwt.sign(
        {
            userId: options.userId,
            jti: refreshJti,
            familyId,
            tokenVersion: options.tokenVersion,
            type: "refresh",
        },
        JWT_SECRET,
        { expiresIn: "7d" }
    );

    try {
        await redis.set(
            refreshTokenKey(refreshJti),
            JSON.stringify({
                userId: options.userId,
                tokenVersion: options.tokenVersion,
                familyId,
            }),
            "EX",
            7 * 24 * 60 * 60
        );
    } catch (err) {
        logger.error({ err }, "[auth.service] Failed to persist refresh token to Redis");
    }

    try {
        await (prisma as any).userSession.upsert({
            where: { familyId },
            create: {
                jti: refreshJti,
                familyId,
                userId: options.userId,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
            update: {
                jti: refreshJti,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
        });
    } catch (err) {
        logger.error({ err }, "[auth.service] Failed to persist UserSession to DB");
    }

    return { accessToken, refreshToken, familyId };
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

export async function sendVerificationEmail(userId: string, email: string, firstName: string): Promise<void> {
    if (!process.env.SYSTEM_SMTP_HOST) {
        logger.warn("[auth.service] SYSTEM_SMTP_HOST not set — skipping email verification send");
        return;
    }

    const verificationToken = crypto.randomUUID();
    await redis.set(emailVerificationKey(verificationToken), userId, "EX", 24 * 60 * 60);

    const appUrl = process.env.APP_URL || "http://localhost:3000";
    const verifyUrl = `${appUrl}/auth/verify-email?token=${verificationToken}`;
    const from = process.env.SYSTEM_SMTP_FROM || process.env.SYSTEM_SMTP_USER!;

    const mailer = getSystemMailer();
    await mailer.sendMail({
        from,
        to: email,
        subject: "Verify your ScoutSend email",
        html: `<p>Hi ${firstName},</p>
<p>Please click the link below to verify your email address. The link expires in 24 hours.</p>
<p><a href="${verifyUrl}">${verifyUrl}</a></p>`,
        text: `Hi ${firstName},\n\nVerify your email here: ${verifyUrl}\n\nThis link expires in 24 hours.`,
    });
}

export async function resendVerification(userId: string) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, firstName: true, emailVerified: true },
    });

    if (!user) {
        throw new AppError("User not found", 404);
    }

    if (user.emailVerified) {
        return { message: "Email is already verified" };
    }

    if (!process.env.SYSTEM_SMTP_HOST) {
        // In development without SMTP, auto-verify is acceptable only if
        // REQUIRE_EMAIL_VERIFICATION is explicitly set to "false".
        if (process.env.REQUIRE_EMAIL_VERIFICATION === "false") {
            await prisma.user.update({
                where: { id: userId },
                data: { emailVerified: true },
            });
            return { message: "Email verification disabled — user auto-verified" };
        }
        throw new AppError("Email verification service is currently unavailable. Please contact support.", 503);
    }

    try {
        await sendVerificationEmail(user.id, user.email, user.firstName);
        return { message: "Verification email sent successfully" };
    } catch (err) {
        logger.error({ err }, "[auth.service] Failed to resend verification email");
        throw new AppError("Failed to send verification email. Please try again later.", 503);
    }
}


export async function registerUser(data: z.infer<typeof registerSchema>) {
    const { email, password, firstName, lastName, orgName } = data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
        throw new AppError("Email already in use", 409);
    }

    const hasSmtp = !!process.env.SYSTEM_SMTP_HOST;
    const requireVerification = process.env.REQUIRE_EMAIL_VERIFICATION !== "false" && hasSmtp;

    const passwordHash = await bcrypt.hash(password, 12);
    const slug = generateOrgSlug(orgName ?? `${firstName} ${lastName}`);
    const workspaceName = orgName ?? `${firstName}'s Workspace`;

    const { user, org } = await prisma.$transaction(async (tx) => {
        const createdUser = await tx.user.create({
            data: { email, passwordHash, firstName, lastName, emailVerified: !requireVerification },
            select: { id: true, email: true, firstName: true, lastName: true, role: true, tokenVersion: true, emailVerified: true },
        });

        const createdOrg = await tx.organization.create({
            data: {
                name: workspaceName,
                slug: await ensureUniqueSlug(tx, slug),
            },
            select: { id: true, name: true, slug: true },
        });

        await tx.organizationMember.create({
            data: {
                orgId: createdOrg.id,
                userId: createdUser.id,
                role: "OWNER",
                joinedAt: new Date(),
            },
        });

        return { user: createdUser, org: createdOrg };
    });

    if (requireVerification) {
        try {
            await sendVerificationEmail(user.id, user.email, user.firstName);
        } catch (err) {
            logger.error({ err }, "[auth.service] Failed to send verification email during registration");
        }
    }

    const isVerified = user.emailVerified;

    const { accessToken, refreshToken } = await issueTokenPair({
        userId: user.id,
        email: user.email,
        role: user.role,
        tokenVersion: user.tokenVersion,
        orgId: org.id,
        orgRole: "OWNER",
        emailVerified: isVerified,
    });

    return { user: { ...user, orgId: org.id, orgRole: "OWNER" as const, org, emailVerified: isVerified }, token: accessToken, refreshToken };
}

export async function loginUser(data: z.infer<typeof loginSchema>, ctx: AuthContext) {
    const { email, password } = data;

    await checkLoginLockout(email);

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
            emailVerified: true,
        },
    });

    if (!user) {
        await bcrypt.compare(password, DUMMY_HASH);
        await recordFailedLogin(email);
        throw new AppError("Invalid email or password", 401);
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
        await recordFailedLogin(email);
        try {
            await logAudit({
                userId: user.id,
                action: "USER LOGIN_FAILED",
                entityId: user.id,
                entityType: "USER",
                ipAddress: ctx.ipAddress,
                userAgent: ctx.userAgent,
                metadata: { email: user.email, reason: "invalid_password" },
            });
        } catch (error) {
            logger.error({ error }, "[audit] failed to log USER_LOGIN_FAILED");
        }
        throw new AppError("Invalid email or password", 401);
    }

    await clearFailedLogins(email);

    const primaryMembership = await prisma.organizationMember.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "asc" },
        select: { orgId: true, role: true },
    });

    const { accessToken, refreshToken } = await issueTokenPair({
        userId: user.id,
        email: user.email,
        role: user.role,
        tokenVersion: user.tokenVersion,
        orgId: primaryMembership?.orgId,
        orgRole: primaryMembership?.role,
        emailVerified: user.emailVerified,
    });

    const { passwordHash: _, ...safeUser } = user;
    return { user: { ...safeUser, orgId: primaryMembership?.orgId, orgRole: primaryMembership?.role }, token: accessToken, refreshToken };
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
            emailVerified: true,
        },
    });

    if (!user) {
        throw new AppError("User not found", 404);
    }

    const primaryMembership = await prisma.organizationMember.findFirst({
        where: { userId },
        orderBy: { createdAt: "asc" },
        select: {
            role: true,
            org: { select: { id: true, name: true, slug: true } },
        },
    });

    return {
        ...user,
        orgId: primaryMembership?.org.id ?? null,
        orgRole: primaryMembership?.role ?? null,
        org: primaryMembership?.org ?? null,
    };
}


export async function logoutUser(token: string, refreshTokenStr?: string, ctx?: AuthContext): Promise<{ blacklisted: boolean }> {
    let decoded: jwt.JwtPayload & { userId: string; email: string };

    try {
        decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload & { userId: string; email: string };
    } catch {
        return { blacklisted: false };
    }

    if (refreshTokenStr) {
        try {
            const refreshDecoded = jwt.verify(refreshTokenStr, JWT_SECRET) as { jti?: string; familyId?: string };
            if (refreshDecoded.jti) {
                await redis.del(refreshTokenKey(refreshDecoded.jti));
            }
            if (refreshDecoded.familyId) {
                await (prisma as any).userSession.deleteMany({ where: { familyId: refreshDecoded.familyId } }).catch((err: unknown) => logger.debug({ err }, "[auth.service] session cleanup failed during logout"));
            }
        } catch (err: unknown) { logger.debug({ err }, "[auth.service] refresh token cleanup failed during logout"); }
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
                ipAddress: ctx?.ipAddress,
                userAgent: ctx?.userAgent,
            });
        } catch (error) {
            logger.error({ error }, "[audit] failed to log USER_LOGOUT");
        }
        return { blacklisted: true };
    }

    return { blacklisted: false };
}

export async function isTokenBlacklisted(jti: string): Promise<boolean> {
    try {
        const result = await redis.get(tokenBlacklistKey(jti));
        return result !== null;
    } catch {
        // Redis unavailable — fall back to DB session check.
        // If the jti has no corresponding active session, treat it as revoked.
        logger.warn("[auth.service] Redis unavailable during blacklist check — falling back to DB session lookup");
        try {
            const session = await (prisma as any).userSession.findFirst({
                where: { jti },
                select: { id: true },
            });
            // No session for this jti means it was either revoked or never persisted.
            // Fail closed: reject tokens we can't verify.
            if (!session) {
                logger.warn({ jti }, "[auth.service] No DB session found for jti during Redis fallback — rejecting token");
                return true;
            }
            return false;
        } catch (dbErr) {
            logger.error({ dbErr }, "[auth.service] Both Redis and DB unavailable — failing closed, rejecting token");
            return true;
        }
    }
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

export async function verifyEmailToken(token: string) {
    const userId = await redis.get(emailVerificationKey(token));

    if (!userId) {
        throw new AppError("Invalid or expired verification token", 400);
    }

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, role: true, tokenVersion: true },
    });

    if (!user) {
        throw new AppError("User not found", 404);
    }

    await prisma.user.update({
        where: { id: userId },
        data: { emailVerified: true },
    });

    await redis.del(emailVerificationKey(token));

    const primaryMembership = await prisma.organizationMember.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "asc" },
        select: { orgId: true, role: true },
    });

    const { accessToken, refreshToken } = await issueTokenPair({
        userId: user.id,
        email: user.email,
        role: user.role,
        tokenVersion: user.tokenVersion,
        orgId: primaryMembership?.orgId,
        orgRole: primaryMembership?.role,
        emailVerified: true,
    });

    return { success: true, token: accessToken, refreshToken };
}

export async function rotateRefreshToken(refreshTokenString: string) {
    let decoded: jwt.JwtPayload & {
        userId: string;
        jti: string;
        familyId: string;
        tokenVersion: number;
        type?: string;
    };

    try {
        decoded = jwt.verify(refreshTokenString, JWT_SECRET) as typeof decoded;
    } catch {
        throw new AppError("Invalid or expired refresh token", 401);
    }

    if (decoded.type !== "refresh" || !decoded.jti || !decoded.familyId) {
        throw new AppError("Invalid refresh token payload", 401);
    }

    const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: { id: true, email: true, role: true, tokenVersion: true, emailVerified: true },
    });

    if (!user || user.tokenVersion !== decoded.tokenVersion) {
        throw new AppError("Session revoked, please log in again", 401);
    }

    let tokenDataRaw: string | null = null;
    try {
        tokenDataRaw = await redis.get(refreshTokenKey(decoded.jti));
    } catch (err) {
        logger.warn({ err }, "[auth.service] Redis error during refresh check, falling back to DB validation");
    }

    if (!tokenDataRaw && redis.status === "ready") {
        let dbSession: { jti: string } | null = null;
        try {
            dbSession = await (prisma as any).userSession.findUnique({
                where: { familyId: decoded.familyId },
                select: { jti: true },
            });
        } catch (err) {
            logger.warn({ err, userId: user.id }, "[auth.service] DB session lookup failed during refresh — failing open");
        }

        if (dbSession === null) {
            logger.error({ userId: user.id, familyId: decoded.familyId }, "[auth.service] Refresh token reuse detected — revoking all sessions");
            await prisma.user.update({
                where: { id: user.id },
                data: { tokenVersion: { increment: 1 } },
            });
            throw new AppError("Refresh token reuse detected. All sessions revoked for security.", 401);
        }

        if (dbSession.jti !== decoded.jti) {
            logger.error({ userId: user.id, familyId: decoded.familyId }, "[auth.service] Refresh token jti mismatch — revoking all sessions");
            await prisma.user.update({
                where: { id: user.id },
                data: { tokenVersion: { increment: 1 } },
            });
            throw new AppError("Refresh token reuse detected. All sessions revoked for security.", 401);
        }

        logger.warn({ userId: user.id, familyId: decoded.familyId }, "[auth.service] Redis miss for refresh token — Redis eviction suspected, allowing via DB session");
    }

    try {
        await redis.del(refreshTokenKey(decoded.jti));
    } catch (err) { logger.debug({ err }, "[auth.service] Redis del failed during token rotation"); }

    const primaryMembership = await prisma.organizationMember.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "asc" },
        select: { orgId: true, role: true },
    });

    return await issueTokenPair({
        userId: user.id,
        email: user.email,
        role: user.role,
        tokenVersion: user.tokenVersion,
        orgId: primaryMembership?.orgId,
        orgRole: primaryMembership?.role,
        familyId: decoded.familyId,
        emailVerified: user.emailVerified,
    });
}