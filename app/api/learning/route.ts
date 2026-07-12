import { NextRequest, NextResponse } from "next/server";
import { API_BASE, proxyRequest } from "../_proxy";

const ALLOWED_QUERY = new Set([
    "eventType",
    "outcome",
    "outreachMessageId",
    "pendingOnly",
    "from",
    "to",
    "page",
    "limit",
]);

function isPositiveInteger(value: string): boolean {
    return /^\d+$/.test(value) && Number(value) > 0;
}

function isBooleanString(value: string): boolean {
    return value === "true" || value === "false";
}

export async function GET(req: NextRequest) {
    const searchParams = req.nextUrl.searchParams;

    const page = searchParams.get("page");
    if (page && !isPositiveInteger(page)) {
        return NextResponse.json(
            { error: "Invalid page parameter" },
            { status: 400 },
        );
    }

    const limit = searchParams.get("limit");
    if (limit && !isPositiveInteger(limit)) {
        return NextResponse.json(
            { error: "Invalid limit parameter" },
            { status: 400 },
        );
    }

    const pendingOnly = searchParams.get("pendingOnly");
    if (pendingOnly && !isBooleanString(pendingOnly)) {
        return NextResponse.json(
            {
                error:
                    "pendingOnly must be either 'true' or 'false'",
            },
            { status: 400 },
        );
    }

    const upstream = new URLSearchParams();

    searchParams.forEach((value, key) => {
        if (ALLOWED_QUERY.has(key)) {
            upstream.set(key, value);
        }
    });

    const query = upstream.toString();

    return proxyRequest(
        query
            ? `${API_BASE}/learning-events?${query}`
            : `${API_BASE}/learning-events`,
    );
}