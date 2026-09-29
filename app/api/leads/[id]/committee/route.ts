import { NextRequest } from "next/server";

const API_BASE = process.env.INTERNAL_API_URL ?? "http://127.0.0.1:8080";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const res = await fetch(
    `${API_BASE}/leads/${id}/committee`,
    {
      headers: { cookie: req.headers.get("cookie") ?? "" },
      cache: "no-store",
    },
  );
  const data = await res.json();
  return Response.json(data, { status: res.status });
}