/**
 * Focused tests for the Replies UX/API resilience layer.
 *
 * Runner: node:test (project standard — `pnpm test` uses `node --import tsx --test`)
 * These tests are pure unit tests — no network, no DB, no DOM.
 *
 * Coverage:
 *  1.  429 response parsing → ApiError with kind=RATE_LIMITED
 *  2.  Retry-After: delta-seconds (valid positive integer)
 *  3.  Retry-After: HTTP-date (future date)
 *  4.  Missing Retry-After header → fallback 30s
 *  5.  Malformed Retry-After (non-numeric, non-date) → fallback 30s
 *  6.  Retry-After exceeding cap (>300s) → clamped to 300
 *  7.  Retry-After: negative seconds → fallback 30s
 *  8.  Retry-After: past HTTP-date → fallback 30s (clamped to null → default)
 *  9.  401 → UNAUTHORIZED, no retryAfterSeconds, not classified as rate-limit
 *  10. 500 → SERVER_ERROR, not classified as rate-limit
 *  11. Network error (fetch throws) → NETWORK_ERROR ApiError
 *  12. No raw "Server error NNN" string appears in any userMessage
 *  13. fetchTabCounts returns {} on non-ok response (no throw)
 *  14. isApiRequestError type guard
 *  15. buildRepliesQuery produces correct query strings for each tab type
 */

import test from "node:test";
import assert from "node:assert/strict";

// ─── Inline the pure logic we are testing ─────────────────────────────────────
// We pull only the pure functions by importing through tsx. In this project
// replyApi.ts has no DOM/React dependency so the import works fine in node:test.
import {
    buildRepliesQuery,
    isApiRequestError,
    ApiRequestError,
    type ApiError,
} from "./replyApi.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal Response-like object usable by parseRetryAfter internals. */
function makeResponse(status: number, headers: Record<string, string> = {}, body: unknown = {}): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...headers },
    });
}

/**
 * Exercise the replyApi fetch path via monkey-patching global fetch.
 * Returns the ApiError that was thrown by fetchReplies.
 */
async function simulateFetchReplies(
    mockResponse: Response | (() => Promise<never>)
): Promise<ApiError> {
    const original = global.fetch;
    if (typeof mockResponse === "function") {
        global.fetch = mockResponse as typeof fetch;
    } else {
        global.fetch = async () => mockResponse;
    }

    const { fetchReplies } = await import("./replyApi.js");
    try {
        await fetchReplies("ALL");
        throw new Error("fetchReplies should have thrown");
    } catch (e) {
        if (e instanceof ApiRequestError) return e.apiError;
        // apiFetch throws a plain ApiError object (not ApiRequestError) for network failures
        if (
            e !== null &&
            typeof e === "object" &&
            "kind" in e &&
            "userMessage" in e
        ) {
            return e as ApiError;
        }
        throw e;

    } finally {
        global.fetch = original;
    }
}

async function simulateFetchTabCounts(
    mockResponse: Response,
): Promise<Record<string, unknown>> {
    const original = global.fetch;
    global.fetch = async () => mockResponse;
    const { fetchTabCounts } = await import("./replyApi.js");
    try {
        return (await fetchTabCounts()) as Record<string, unknown>;
    } finally {
        global.fetch = original;
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

// Test 1: 429 classified as RATE_LIMITED
test("1 · 429 response → ApiError with kind=RATE_LIMITED", async () => {
    const err = await simulateFetchReplies(makeResponse(429, { "retry-after": "15" }));
    assert.equal(err.kind, "RATE_LIMITED");
    assert.equal(err.status, 429);
});

// Test 2: Retry-After delta-seconds
test("2 · Retry-After delta-seconds parsed correctly", async () => {
    const err = await simulateFetchReplies(makeResponse(429, { "retry-after": "42" }));
    assert.equal(err.kind, "RATE_LIMITED");
    assert.equal(err.retryAfterSeconds, 42);
});

// Test 3: Retry-After HTTP-date (future)
test("3 · Retry-After HTTP-date (future) parsed to positive seconds", async () => {
    const futureDate = new Date(Date.now() + 20_000).toUTCString(); // 20s in future
    const err = await simulateFetchReplies(makeResponse(429, { "retry-after": futureDate }));
    assert.equal(err.kind, "RATE_LIMITED");
    assert.ok(err.retryAfterSeconds !== null, "retryAfterSeconds should not be null");
    assert.ok((err.retryAfterSeconds as number) > 0, "retryAfterSeconds should be positive");
    assert.ok((err.retryAfterSeconds as number) <= 25, "retryAfterSeconds should be roughly 20s");
});

// Test 4: Missing Retry-After → fallback 30
test("4 · Missing Retry-After header → fallback 30s", async () => {
    const err = await simulateFetchReplies(makeResponse(429, {}));
    assert.equal(err.kind, "RATE_LIMITED");
    assert.equal(err.retryAfterSeconds, 30);
});

// Test 5: Malformed Retry-After (garbage string) → fallback 30
test("5 · Malformed Retry-After (non-numeric, non-date) → fallback 30s", async () => {
    const err = await simulateFetchReplies(makeResponse(429, { "retry-after": "garbage!!!" }));
    assert.equal(err.kind, "RATE_LIMITED");
    assert.equal(err.retryAfterSeconds, 30);
});

// Test 6: Retry-After exceeding 300s cap → clamped
test("6 · Retry-After > 300 → clamped to 300", async () => {
    const err = await simulateFetchReplies(makeResponse(429, { "retry-after": "9999" }));
    assert.equal(err.kind, "RATE_LIMITED");
    assert.equal(err.retryAfterSeconds, 300);
});

// Test 7: Retry-After: 0 → treated as missing → fallback 30
test("7 · Retry-After: 0 (non-positive) → fallback 30s", async () => {
    const err = await simulateFetchReplies(makeResponse(429, { "retry-after": "0" }));
    assert.equal(err.kind, "RATE_LIMITED");
    assert.equal(err.retryAfterSeconds, 30);
});

// Test 8: Retry-After: past HTTP-date → fallback 30
test("8 · Retry-After past HTTP-date → fallback 30s", async () => {
    const pastDate = new Date(Date.now() - 5_000).toUTCString(); // 5s in the past
    const err = await simulateFetchReplies(makeResponse(429, { "retry-after": pastDate }));
    assert.equal(err.kind, "RATE_LIMITED");
    assert.equal(err.retryAfterSeconds, 30);
});

// Test 9: 401 → UNAUTHORIZED, not rate-limited
test("9 · 401 → UNAUTHORIZED — not classified as RATE_LIMITED", async () => {
    const err = await simulateFetchReplies(makeResponse(401));
    assert.equal(err.kind, "UNAUTHORIZED");
    assert.equal(err.retryAfterSeconds, null);
    assert.notEqual(err.kind, "RATE_LIMITED");
});

// Test 10: 500 → SERVER_ERROR, not rate-limited
test("10 · 500 → SERVER_ERROR — not classified as RATE_LIMITED", async () => {
    const err = await simulateFetchReplies(makeResponse(500));
    assert.equal(err.kind, "SERVER_ERROR");
    assert.notEqual(err.kind, "RATE_LIMITED");
});

// Test 11: Network error (fetch throws) → NETWORK_ERROR ApiError
test("11 · Network fetch failure → NETWORK_ERROR ApiError (not raw Error)", async () => {
    const thrower = async () => { throw new TypeError("Failed to fetch"); };
    const err = await simulateFetchReplies(thrower as any);
    assert.equal(err.kind, "NETWORK_ERROR");
    assert.equal(err.status, null);
});

// Test 12: No raw "Server error NNN" string in any userMessage
test("12 · No raw 'Server error NNN' string appears in any userMessage", async () => {
    const statuses = [400, 401, 403, 404, 429, 500, 502, 503, 504];
    for (const status of statuses) {
        const err = await simulateFetchReplies(makeResponse(status));
        assert.ok(
            !err.userMessage.toLowerCase().includes("server error"),
            `status ${status} produced "Server error" in userMessage: "${err.userMessage}"`,
        );
        assert.ok(
            !err.userMessage.includes(String(status)),
            `status ${status} leaked raw status code into userMessage: "${err.userMessage}"`,
        );
    }
});

// Test 13: fetchTabCounts returns {} on non-ok (no throw)
test("13 · fetchTabCounts returns empty object on non-ok response — does not throw", async () => {
    const result = await simulateFetchTabCounts(makeResponse(429));
    assert.deepEqual(result, {});
});

// Test 14: isApiRequestError type guard
test("14 · isApiRequestError correctly identifies ApiRequestError instances", () => {
    const apiErr = new ApiRequestError({
        kind: "RATE_LIMITED",
        status: 429,
        retryAfterSeconds: 15,
        userMessage: "test",
    });
    const plainErr = new Error("plain");

    assert.ok(isApiRequestError(apiErr), "should return true for ApiRequestError");
    assert.ok(!isApiRequestError(plainErr), "should return false for plain Error");
    assert.ok(!isApiRequestError(null), "should return false for null");
    assert.ok(!isApiRequestError("string"), "should return false for string");
});

// Test 15: buildRepliesQuery produces correct query strings
test("15 · buildRepliesQuery produces correct query params for all tab types", () => {
    // ALL tab — no intent/requiresHumanReview
    const allQ = new URLSearchParams(buildRepliesQuery("ALL", 1, 40));
    assert.ok(!allQ.has("intent"), "ALL tab should not have intent param");
    assert.ok(!allQ.has("requiresHumanReview"), "ALL tab should not have requiresHumanReview");
    assert.equal(allQ.get("page"), "1");
    assert.equal(allQ.get("limit"), "40");

    // NEEDS_REVIEW tab
    const nrQ = new URLSearchParams(buildRepliesQuery("NEEDS_REVIEW", 2, 20));
    assert.equal(nrQ.get("requiresHumanReview"), "true");
    assert.ok(!nrQ.has("intent"), "NEEDS_REVIEW should not set intent param");
    assert.equal(nrQ.get("page"), "2");
    assert.equal(nrQ.get("limit"), "20");

    // Intent tab (POSITIVE)
    const posQ = new URLSearchParams(buildRepliesQuery("POSITIVE", 1, 40));
    assert.equal(posQ.get("intent"), "POSITIVE");
    assert.ok(!posQ.has("requiresHumanReview"), "intent tab should not have requiresHumanReview");

    // Intent tab (OUT_OF_OFFICE)
    const oooQ = new URLSearchParams(buildRepliesQuery("OUT_OF_OFFICE", 1, 40));
    assert.equal(oooQ.get("intent"), "OUT_OF_OFFICE");
});
