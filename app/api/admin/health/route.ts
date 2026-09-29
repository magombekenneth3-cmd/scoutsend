import { NextRequest } from "next/server";

export async function GET(req: NextRequest): Promise<Response> {
    const apiBase = process.env.INTERNAL_API_URL ?? "http://127.0.0.1:8080";
    const res = await fetch(`${apiBase}/admin/health`, {
        headers: { cookie: req.headers.get("cookie") ?? "" },
        cache: "no-store",
    });
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) {
        const text = await res.text();
        return Response.json({ error: text || `Upstream ${res.status}` }, { status: res.status });
    }
    const data = await res.json();
    return Response.json(data, { status: res.status });
}