import { NextRequest, NextResponse } from "next/server";
import { API_BASE, proxyRequest } from "../../_proxy";

type RouteContext = {
    params: Promise<{
        id: string;
    }>;
};

function buildTraceUrl(id: string): string | null {
    const traceId = id.trim();

    if (!traceId) {
        return null;
    }

    return `${API_BASE}/ai-traces/${encodeURIComponent(traceId)}`;
}

export async function GET(
    _req: NextRequest,
    { params }: RouteContext,
) {
    const { id } = await params;

    const url = buildTraceUrl(id);

    if (!url) {
        return NextResponse.json(
            { error: "Invalid trace ID" },
            { status: 400 },
        );
    }

    return proxyRequest(url);
}

export async function DELETE(
    _req: NextRequest,
    { params }: RouteContext,
) {
    const { id } = await params;

    const url = buildTraceUrl(id);

    if (!url) {
        return NextResponse.json(
            { error: "Invalid trace ID" },
            { status: 400 },
        );
    }

    return proxyRequest(url, {
        method: "DELETE",
    });
}