import { NextRequest, NextResponse } from "next/server";
import { jwtVerify, JWTPayload } from "jose";
import IORedis from "ioredis";

const AUTH_ROUTES = new Set([
    "/auth/login",
    "/auth/register",
    "/auth/forgot-password",
    "/auth/reset-password",
]);

const _g = globalThis as typeof globalThis & { __proxyRedis?: IORedis };

function getRedis(): IORedis {
    if (!_g.__proxyRedis) {
        _g.__proxyRedis = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
            maxRetriesPerRequest: 1,
            enableOfflineQueue: false,
            lazyConnect: true,
        });
    }
    return _g.__proxyRedis;
}

async function verifyToken(
    token: string,
    secret: Uint8Array
): Promise<JWTPayload | null> {
    try {
        const { payload } = await jwtVerify(token, secret);
        if (!payload.userId) return null;
        return payload;
    } catch {
        return null;
    }
}

async function isBlacklisted(jti: string): Promise<boolean> {
    try {
        const result = await getRedis().get(`auth:blacklist:${jti}`);
        return result !== null;
    } catch {
        return false;
    }
}

export async function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;
    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
        console.error("[proxy] JWT_SECRET is not configured");
        if (pathname.startsWith("/api/")) {
            return NextResponse.json(
                { error: "Server misconfiguration" },
                { status: 500 }
            );
        }
        return NextResponse.redirect(new URL("/auth/login", request.url));
    }

    const token = request.cookies.get("token")?.value;
    let user: JWTPayload | null = null;

    if (token) {
        const secret = new TextEncoder().encode(jwtSecret);
        user = await verifyToken(token, secret);
        if (user?.jti) {
            const revoked = await isBlacklisted(String(user.jti));
            if (revoked) {
                user = null;
            }
        }
    }

    if (
        pathname.startsWith("/api/") &&
        !pathname.startsWith("/api/auth/")
    ) {
        if (!user) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401, headers: { "Cache-Control": "no-store" } }
            );
        }
        const requestHeaders = new Headers(request.headers);
        requestHeaders.set("x-user-id", String(user.userId));
        if (user.email) {
            requestHeaders.set("x-user-email", String(user.email));
        }
        return NextResponse.next({ request: { headers: requestHeaders } });
    }

    if (pathname.startsWith("/dashboard") && !user) {
        return NextResponse.redirect(new URL("/auth/login", request.url));
    }

    if (pathname === "/" && user) {
        return NextResponse.redirect(new URL("/dashboard", request.url));
    }

    if (AUTH_ROUTES.has(pathname) && user) {
        return NextResponse.redirect(new URL("/dashboard", request.url));
    }

    return NextResponse.next();
}

export default proxy;

export const config = {
    matcher: [
        "/",
        "/dashboard/:path*",
        "/auth/login",
        "/auth/register",
        "/auth/forgot-password",
        "/auth/reset-password",
        "/api/:path*",
    ],
};