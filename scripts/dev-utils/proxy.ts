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

async function isTokenExpired(token: string, secret: Uint8Array): Promise<boolean> {
    try {
        await jwtVerify(token, secret);
        return false;
    } catch (err) {
        return (err as { code?: string }).code === "ERR_JWT_EXPIRED";
    }
}

const _g2 = globalThis as typeof globalThis & {
    __jtiCache?: Map<string, { blacklisted: boolean; at: number }>;
};

const JTI_TTL_MS = 30_000;
const JTI_CACHE_MAX = 500;

function getJtiCache() {
    if (!_g2.__jtiCache) _g2.__jtiCache = new Map();
    return _g2.__jtiCache;
}

async function isBlacklisted(jti: string): Promise<boolean> {
    const cache = getJtiCache();
    const now = Date.now();
    const entry = cache.get(jti);
    if (entry && now - entry.at < JTI_TTL_MS) return entry.blacklisted;

    try {
        const result = await getRedis().get(`auth:blacklist:${jti}`);
        const blacklisted = result !== null;
        if (cache.size >= JTI_CACHE_MAX) {
            const oldest = cache.keys().next().value;
            if (oldest) cache.delete(oldest);
        }
        cache.set(jti, { blacklisted, at: now });
        return blacklisted;
    } catch {
        return false;
    }
}

async function tryRefreshFromCookie(
    request: NextRequest,
    secret: Uint8Array
): Promise<{ accessToken: string; refreshToken: string; user: JWTPayload } | null> {
    const refreshTokenStr = request.cookies.get("refreshToken")?.value;
    if (!refreshTokenStr) return null;

    try {
        const apiBase = process.env.INTERNAL_API_URL || "http://localhost:3001";
        const res = await fetch(`${apiBase}/auth/refresh`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                cookie: `refreshToken=${refreshTokenStr}`,
            },
        });

        if (!res.ok) return null;

        const body = await res.json() as { token?: string; refreshToken?: string };
        const newAccess = body.token;
        const newRefresh = body.refreshToken;

        if (!newAccess || !newRefresh) return null;

        const { payload } = await jwtVerify(newAccess, secret);
        if (!payload.userId) return null;

        return { accessToken: newAccess, refreshToken: newRefresh, user: payload };
    } catch {
        return null;
    }
}

const isProd = process.env.NODE_ENV === "production";
const cookieSameSite = (process.env.COOKIE_SAME_SITE ?? "lax") as "lax" | "strict" | "none";

const ACCESS_COOKIE_OPTS = {
    httpOnly: true,
    secure: isProd || cookieSameSite === "none",
    sameSite: cookieSameSite,
    path: "/",
    maxAge: 15 * 60,
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
};

const REFRESH_COOKIE_OPTS = {
    httpOnly: true,
    secure: isProd || cookieSameSite === "none",
    sameSite: cookieSameSite,
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
};

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

    const secret = new TextEncoder().encode(jwtSecret);
    const rawToken = request.cookies.get("token")?.value;

    let user: JWTPayload | null = null;
    let freshAccessToken: string | null = null;
    let freshRefreshToken: string | null = null;

    if (rawToken) {
        user = await verifyToken(rawToken, secret);

        if (user?.jti) {
            const revoked = await isBlacklisted(String(user.jti));
            if (revoked) user = null;
        }

        if (!user && await isTokenExpired(rawToken, secret)) {
            const refreshed = await tryRefreshFromCookie(request, secret);
            if (refreshed) {
                user = refreshed.user;
                freshAccessToken = refreshed.accessToken;
                freshRefreshToken = refreshed.refreshToken;
            }
        }
    }

    function applyRefreshedCookies(response: NextResponse): NextResponse {
        if (freshAccessToken) {
            response.cookies.set("token", freshAccessToken, ACCESS_COOKIE_OPTS);
        }
        if (freshRefreshToken) {
            response.cookies.set("refreshToken", freshRefreshToken, REFRESH_COOKIE_OPTS);
        }
        return response;
    }

    if (
        pathname.startsWith("/api/") &&
        !pathname.startsWith("/api/auth/")
    ) {
        if (!user) {
            const expired = rawToken && await isTokenExpired(rawToken, secret);
            return NextResponse.json(
                { error: "Unauthorized", ...(expired ? { code: "TOKEN_EXPIRED" } : {}) },
                { status: 401, headers: { "Cache-Control": "no-store" } }
            );
        }
        const requestHeaders = new Headers(request.headers);
        requestHeaders.set("x-user-id", String(user.userId));
        if (user.email) requestHeaders.set("x-user-email", String(user.email));
        const response = NextResponse.next({ request: { headers: requestHeaders } });
        return applyRefreshedCookies(response);
    }

    if (pathname.startsWith("/dashboard") && !user) {
        const loginUrl = new URL("/auth/login", request.url);
        loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
        return NextResponse.redirect(loginUrl);
    }

    if (pathname === "/" && user) {
        return applyRefreshedCookies(NextResponse.redirect(new URL("/dashboard", request.url)));
    }

    if (AUTH_ROUTES.has(pathname) && user) {
        return applyRefreshedCookies(NextResponse.redirect(new URL("/dashboard", request.url)));
    }

    return applyRefreshedCookies(NextResponse.next());
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