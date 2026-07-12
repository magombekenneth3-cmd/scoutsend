import { NextRequest } from "next/server";

export async function GET(req: NextRequest): Promise<Response> {
    const search = req.nextUrl.searchParams.toString();
    const res = await fetch(
        `${process.env.API_BASE_URL}/users${search ? `?${search}` : ""}`,
        {
            headers: { cookie: req.headers.get("cookie") ?? "" },
            cache: "no-store",
        }
    );
    const data = await res.json();
    return Response.json(data, { status: res.status });
}