import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { API_BASE } from "../../_proxy";

export async function POST(req: NextRequest) {
    try {
        const cookieStore = await cookies();
        const token = cookieStore.get("token")?.value;

        const res = await fetch(`${API_BASE}/auth/resend-verification`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Requested-With": "XMLHttpRequest",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(req.headers.get("cookie") ? { Cookie: req.headers.get("cookie")! } : {}),
            },
        });

        const data = await res.json();
        return NextResponse.json(data, { status: res.status });
    } catch {
        return NextResponse.json({ error: "Failed to reach API server" }, { status: 502 });
    }
}
