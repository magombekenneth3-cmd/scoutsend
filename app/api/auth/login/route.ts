import { NextRequest, NextResponse } from "next/server";
import { isRateLimited, getClientIp } from "@/app/api/src/lib/rateLimit";

import { API_BASE } from "../../_proxy";

export async function POST(req: NextRequest) {
    try {
        const ip = getClientIp(req);
        const limited = await isRateLimited(`rate:auth:login:${ip}`, 20, 900);
        if (limited) {
            return NextResponse.json({ error: "Too many attempts, please try again later" }, { status: 429 });
        }

        const body = await req.json();
        const res = await fetch(`${API_BASE}/auth/login`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Requested-With": "XMLHttpRequest",
            },
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