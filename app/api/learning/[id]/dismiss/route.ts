import { API_BASE, proxyRequest } from "@/app/api/_proxy";
import { NextRequest, NextResponse } from "next/server";


type RouteContext = {
    params: Promise<{
        id: string;
    }>;
};

function buildDismissUrl(id: string): string | null {
    const eventId = id.trim();

    if (!eventId) {
        return null;
    }

    return `${API_BASE}/learning-events/${encodeURIComponent(
        eventId,
    )}/dismiss`;
}

export async function POST(
    req: NextRequest,
    { params }: RouteContext,
) {
    const { id } = await params;

    const url = buildDismissUrl(id);

    if (!url) {
        return NextResponse.json(
            { error: "Invalid event ID" },
            { status: 400 },
        );
    }

    let body: unknown = {};

    try {
        const contentType =
            req.headers.get("content-type") ?? "";

        if (contentType.includes("application/json")) {
            body = await req.json();
        }
    } catch {
        return NextResponse.json(
            { error: "Invalid JSON body" },
            { status: 400 },
        );
    }

    return proxyRequest(url, {
        method: "POST",
        body: JSON.stringify(body),
    });
}