import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.INTERNAL_API_URL ?? "http://localhost:3001";

async function proxy(req: NextRequest, path: string) {
    const cookie = req.headers.get("cookie") ?? "";
    const body = await req.text();
    const res = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            cookie,
        },
        body,
    });
    const data = await res.text();
    return new NextResponse(data, {
        status: res.status,
        headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
}

export async function POST(req: NextRequest) {
    return proxy(req, "/api/leads/bulk/suppress");
}
