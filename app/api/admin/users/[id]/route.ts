import { NextRequest } from "next/server";

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
    const { id } = await params;
    const res = await fetch(`${process.env.API_BASE_URL}/admin/users/${id}`, {
        method: "DELETE",
        headers: { cookie: req.headers.get("cookie") ?? "" },
    });
    if (res.status === 204) return new Response(null, { status: 204 });
    const data = await res.json();
    return Response.json(data, { status: res.status });
}