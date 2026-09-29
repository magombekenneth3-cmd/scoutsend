import { NextRequest } from "next/server";

const API_BASE = process.env.INTERNAL_API_URL ?? "http://127.0.0.1:8080";

export async function GET(req: NextRequest): Promise<Response> {
    const search = req.nextUrl.searchParams.toString();
    const res = await fetch(
        `${API_BASE}/users${search ? `?${search}` : ""}`,
        {
            headers: { cookie: req.headers.get("cookie") ?? "" },
            cache: "no-store",
        }
    );
    const data = await res.json();
    return Response.json(data, { status: res.status });
}