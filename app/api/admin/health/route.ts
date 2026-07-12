import { NextRequest } from "next/server";

export async function GET(req: NextRequest): Promise<Response> {
    const res = await fetch(`${process.env.API_BASE_URL}/admin/health`, {
        headers: { cookie: req.headers.get("cookie") ?? "" },
        cache: "no-store",
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
}