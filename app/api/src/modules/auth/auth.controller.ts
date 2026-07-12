import { Request, Response, NextFunction } from "express";
import {
    registerUser,
    loginUser,
    getMe,
    logoutUser,
    forgotPassword,
    resetPassword,
} from "./auth.service";
import { AuthenticatedRequest } from "./auth.types";
import { forgotPasswordSchema, resetPasswordSchema } from "./auth.schema";

const COOKIE_OPTS = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
};

export async function register(req: Request, res: Response) {
    try {
        const { user, token } = await registerUser(req.body);

        res.cookie("token", token, COOKIE_OPTS);

        return res.status(201).json({ success: true, user });
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
        const { user, token } = await loginUser(req.body, ctx);

        res.cookie("token", token, COOKIE_OPTS);

        return res.status(200).json({ success: true, user });
    } catch (error) {
        return res.status(400).json({ error: (error as Error).message });
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

export async function logout(req: AuthenticatedRequest, res: Response) {
    try {
        const token =
            req.cookies?.token ??
            req.headers.authorization?.split(" ")[1];

        if (token) {
            const ctx = {
                ipAddress: req.ip,
                userAgent: req.headers["user-agent"] as string || undefined,
            };
            await logoutUser(token, ctx);
        }

        res.clearCookie("token", { path: "/" });
        res.status(200).json({ message: "Logged out successfully" });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
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