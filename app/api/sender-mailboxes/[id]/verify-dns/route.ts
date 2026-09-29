import { NextRequest } from "next/server";
import { API_BASE, proxyRequest } from "@/app/api/_proxy";

export async function POST(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    return proxyRequest(`${API_BASE}/sender-mailboxes/${encodeURIComponent(id)}/verify-dns`, {
        method: "POST",
    });
}
