import { NextRequest, NextResponse } from "next/server";
import { API_BASE } from "../../_proxy";
import { isRateLimited, getClientIp } from "@/app/api/src/lib/rateLimit";

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const limited = await isRateLimited(`rate:auth:reset:${ip}`, 20, 900);
    if (limited) {
      return NextResponse.json({ error: "Too many attempts, please try again later" }, { status: 429 });
    }

    const body = await req.json();
    const res = await fetch(`${API_BASE}/auth/reset-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": ip,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Failed to reach API server" }, { status: 502 });
  }
}