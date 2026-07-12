import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.INTERNAL_API_URL ?? "http://localhost:3001";

export async function PATCH(req: NextRequest) {
    const cookie = req.headers.get("cookie") ?? "";
    const body = await req.text();
    const res = await fetch(`${API_BASE}/api/users/profile`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body,
    });
    const data = await res.text();
    return new NextResponse(data, {
        status: res.status,
        headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
}
