import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.INTERNAL_API_URL!;

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const res = await fetch(`${API_BASE}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

        const data = await res.json();
        const response = NextResponse.json(data, { status: res.status });

        const setCookie = res.headers.get("set-cookie");
        if (setCookie) {
            response.headers.set("set-cookie", setCookie);
        }

        return response;
    } catch {
        return NextResponse.json({ error: "Failed to reach API server" }, { status: 502 });
    }
}