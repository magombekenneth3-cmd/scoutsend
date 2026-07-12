import { NextResponse } from "next/server";

const API_BASE = process.env.INTERNAL_API_URL!;

export async function POST(req: Request) {
    try {
        const res = await fetch(`${API_BASE}/auth/logout`, {
            method: "POST",
            headers: { cookie: req.headers.get("cookie") ?? "" },
        });
        const response = NextResponse.json(
            await res.json(),
            { status: res.status }
        );
        response.cookies.set("token", "", { maxAge: 0, path: "/" });
        return response;
    } catch {
        const response = NextResponse.json(
            { error: "Failed to reach API server" },
            { status: 502 }
        );
        response.cookies.set("token", "", { maxAge: 0, path: "/" });
        return response;
    }
}