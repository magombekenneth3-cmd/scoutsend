import { NextResponse } from "next/server";

import { API_BASE } from "../../_proxy";

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