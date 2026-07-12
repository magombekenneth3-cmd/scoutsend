import { NextRequest } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const res = await fetch(
    `${process.env.API_BASE_URL}/leads/${id}/committee`,
    {
      headers: { cookie: req.headers.get("cookie") ?? "" },
      cache: "no-store",
    },
  );
  const data = await res.json();
  return Response.json(data, { status: res.status });
}