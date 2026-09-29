import { Request, Response, NextFunction } from "express";
import {
    registerUser,
    loginUser,
    getMe,
    logoutUser,
    forgotPassword,
    resetPassword,
    verifyEmailToken,
    resendVerification,
    rotateRefreshToken,
} from "./auth.service";
import { AuthenticatedRequest } from "./auth.types";
import { forgotPasswordSchema, resetPasswordSchema } from "./auth.schema";

const isProd = process.env.NODE_ENV === "production";
const cookieSameSite = (process.env.COOKIE_SAME_SITE ?? "lax") as "lax" | "strict" | "none";

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const ACCESS_COOKIE_OPTS = {
    httpOnly: true,
    secure: isProd || cookieSameSite === "none",
    sameSite: cookieSameSite,
    path: "/",
    maxAge: 15 * 60 * 1000,
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
};

const REFRESH_COOKIE_OPTS = {
    httpOnly: true,
    secure: isProd || cookieSameSite === "none",
    sameSite: cookieSameSite,
    path: "/",
    maxAge: REFRESH_TOKEN_TTL_MS,
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
};

const CLEAR_COOKIE_OPTS = {
    path: "/",
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
};

export async function register(req: Request, res: Response) {
    try {
        const { user, token, refreshToken } = await registerUser(req.body);

        res.cookie("token", token, ACCESS_COOKIE_OPTS);
        res.cookie("refreshToken", refreshToken, REFRESH_COOKIE_OPTS);

        return res.status(201).json({ success: true, user, token, refreshToken });
    } catch (error) {
        res.status(400).json({ error: (error as Error).message });
    }
}

export async function login(req: Request, res: Response) {
    try {
        const ctx = {
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"],
        };
        const { user, token, refreshToken } = await loginUser(req.body, ctx);

        res.cookie("token", token, ACCESS_COOKIE_OPTS);
        res.cookie("refreshToken", refreshToken, REFRESH_COOKIE_OPTS);

        return res.status(200).json({ success: true, user, token, refreshToken });
    } catch (error) {
        return res.status(400).json({ error: (error as Error).message });
    }
}

export async function refresh(req: Request, res: Response) {
    try {
        const refreshTokenStr = req.cookies?.refreshToken || req.body?.refreshToken;
        if (!refreshTokenStr) {
            return res.status(401).json({ error: "Refresh token missing" });
        }

        const { accessToken, refreshToken: newRefreshToken } = await rotateRefreshToken(refreshTokenStr);

        res.cookie("token", accessToken, ACCESS_COOKIE_OPTS);
        res.cookie("refreshToken", newRefreshToken, REFRESH_COOKIE_OPTS);

        return res.status(200).json({ success: true, token: accessToken, refreshToken: newRefreshToken });
    } catch (error) {
        res.clearCookie("token", CLEAR_COOKIE_OPTS);
        res.clearCookie("refreshToken", CLEAR_COOKIE_OPTS);
        return res.status(401).json({ error: (error as Error).message });
    }
}

export async function me(req: AuthenticatedRequest, res: Response) {
    try {
        const user = await getMe(req.user!.userId);
        res.status(200).json(user);
    } catch (error) {
        res.status(404).json({ error: (error as Error).message });
    }
}

export async function logout(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
        const token =
            req.cookies?.token ??
            req.headers.authorization?.split(" ")[1];
        const refreshTokenStr = req.cookies?.refreshToken ?? req.body?.refreshToken;

        if (token) {
            const ctx = {
                ipAddress: req.ip,
                userAgent: req.headers["user-agent"] as string || undefined,
            };
            await logoutUser(token, refreshTokenStr, ctx);
        }

        res.clearCookie("token", CLEAR_COOKIE_OPTS);
        res.clearCookie("refreshToken", CLEAR_COOKIE_OPTS);
        res.status(200).json({ message: "Logged out successfully" });
    } catch (error) {
        next(error);
    }
}

export async function forgotPasswordHandler(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const data = forgotPasswordSchema.parse(req.body);
        await forgotPassword(data);
        res.status(200).json({ message: "If that email exists, a reset link has been sent" });
    } catch (error) {
        next(error);
    }
}

export async function resetPasswordHandler(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const data = resetPasswordSchema.parse(req.body);
        await resetPassword(data);
        res.status(200).json({ message: "Password updated successfully" });
    } catch (error) {
        next(error);
    }
}

export async function verifyEmailHandler(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { token } = req.body as { token: string };
        const result = await verifyEmailToken(token);

        res.cookie("token", result.token, ACCESS_COOKIE_OPTS);
        if (result.refreshToken) {
            res.cookie("refreshToken", result.refreshToken, REFRESH_COOKIE_OPTS);
        }
        res.status(200).json({ success: true, message: "Email verified successfully", token: result.token, refreshToken: result.refreshToken });
    } catch (error) {
        next(error);
    }
}

export async function resendVerificationHandler(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }
        const result = await resendVerification(userId);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
}