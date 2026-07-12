import { NextRequest, NextResponse } from "next/server";
import { API_BASE, proxyRequest } from "../_proxy";

const ALLOWED_QUERY = new Set([
    "agentName",
    "model",
    "minConfidence",
    "maxConfidence",
    "from",
    "to",
    "page",
    "limit",
]);

function isPositiveInteger(value: string): boolean {
    return /^\d+$/.test(value) && Number(value) > 0;
}

function isValidConfidence(value: string): boolean {
    const num = Number(value);

    return (
        Number.isFinite(num) &&
        num >= 0 &&
        num <= 1
    );
}

export async function GET(req: NextRequest) {
    const searchParams = req.nextUrl.searchParams;

    const page = searchParams.get("page");
    if (page && !isPositiveInteger(page)) {
        return NextResponse.json(
            { error: "Invalid page parameter" },
            { status: 400 }
        );
    }

    const limit = searchParams.get("limit");
    if (limit && !isPositiveInteger(limit)) {
        return NextResponse.json(
            { error: "Invalid limit parameter" },
            { status: 400 }
        );
    }

    const minConfidence = searchParams.get("minConfidence");
    if (minConfidence && !isValidConfidence(minConfidence)) {
        return NextResponse.json(
            { error: "minConfidence must be between 0 and 1" },
            { status: 400 }
        );
    }

    const maxConfidence = searchParams.get("maxConfidence");
    if (maxConfidence && !isValidConfidence(maxConfidence)) {
        return NextResponse.json(
            { error: "maxConfidence must be between 0 and 1" },
            { status: 400 }
        );
    }

    if (
        minConfidence &&
        maxConfidence &&
        Number(minConfidence) > Number(maxConfidence)
    ) {
        return NextResponse.json(
            {
                error:
                    "minConfidence cannot be greater than maxConfidence",
            },
            { status: 400 }
        );
    }

    const upstream = new URLSearchParams();

    searchParams.forEach((value, key) => {
        if (ALLOWED_QUERY.has(key) && value !== "") {
            upstream.set(key, value);
        }
    });

    const query = upstream.toString();

    return proxyRequest(
        query
            ? `${API_BASE}/ai-traces?${query}`
            : `${API_BASE}/ai-traces`
    );
}