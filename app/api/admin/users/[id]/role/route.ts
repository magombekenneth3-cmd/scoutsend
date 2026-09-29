import { NextRequest } from "next/server";

const API_BASE = process.env.INTERNAL_API_URL ?? "http://127.0.0.1:8080";

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
    const { id } = await params;
    const body = await req.json();
    const res = await fetch(`${API_BASE}/users/${id}/role`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            cookie: req.headers.get("cookie") ?? "",
        },
        body: JSON.stringify(body),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
}