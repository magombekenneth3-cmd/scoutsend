import { NextRequest } from "next/server";

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
    const { id } = await params;
    const body = await req.json();
    const res = await fetch(`${process.env.API_BASE_URL}/users/${id}/role`, {
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