/**
 * Regression script for gemini.limiter.ts BUCKET_CONFIGS.
 *
 * State-3 change under test: gemini-3.1-flash-lite now has an explicit
 * bucket entry (rpm: 30, concurrency: 5) and must not silently fall back
 * to DEFAULT_CONFIG.
 *
 * This is a standalone assertion script (no node:test runner) consistent
 * with the CJS/tsx environment used in this repository, which does not
 * support mock.module().
 *
 * Verified assertions:
 *   T1  gemini-3.1-flash-lite → { rpm: 30, concurrency: 5 } (explicit bucket)
 *   T2  gemini-3.1-flash-lite !== DEFAULT_CONFIG
 *   T3  gemini-2.0-flash → { rpm: 30, concurrency: 5 } (unchanged)
 *   T4  gemini-2.5-flash → { rpm: 20, concurrency: 3 } (unchanged)
 *   T5  text-embedding-004 → { rpm: 50, concurrency: 10 } (unchanged)
 *   T6  unknown model is absent from BUCKET_CONFIGS
 *   T7  DEFAULT_CONFIG remains { rpm: 15, concurrency: 3 } (not modified)
 */
import assert from "node:assert/strict";
import { BUCKET_CONFIGS, DEFAULT_CONFIG } from "./gemini.limiter";

function runTests() {
    // T1: gemini-3.1-flash-lite has an explicit bucket
    const lite = BUCKET_CONFIGS["gemini-3.1-flash-lite"];
    assert.ok(lite !== undefined, "T1 FAIL: gemini-3.1-flash-lite must have an explicit bucket entry");
    assert.deepStrictEqual(
        lite,
        { rpm: 30, concurrency: 5 },
        "T1 FAIL: gemini-3.1-flash-lite must be { rpm: 30, concurrency: 5 } when env vars absent",
    );
    console.log("[PASS] T1: gemini-3.1-flash-lite → { rpm: 30, concurrency: 5 }");

    // T2: gemini-3.1-flash-lite is distinct from DEFAULT_CONFIG
    assert.notDeepStrictEqual(
        lite,
        DEFAULT_CONFIG,
        "T2 FAIL: gemini-3.1-flash-lite must not equal DEFAULT_CONFIG",
    );
    console.log("[PASS] T2: gemini-3.1-flash-lite is distinct from DEFAULT_CONFIG");

    // T3: gemini-2.0-flash unchanged
    assert.deepStrictEqual(
        BUCKET_CONFIGS["gemini-2.0-flash"],
        { rpm: 30, concurrency: 5 },
        "T3 FAIL: gemini-2.0-flash must be { rpm: 30, concurrency: 5 }",
    );
    console.log("[PASS] T3: gemini-2.0-flash → { rpm: 30, concurrency: 5 } (unchanged)");

    // T4: gemini-2.5-flash unchanged
    assert.deepStrictEqual(
        BUCKET_CONFIGS["gemini-2.5-flash"],
        { rpm: 20, concurrency: 3 },
        "T4 FAIL: gemini-2.5-flash must be { rpm: 20, concurrency: 3 }",
    );
    console.log("[PASS] T4: gemini-2.5-flash → { rpm: 20, concurrency: 3 } (unchanged)");

    // T5: text-embedding-004 unchanged
    assert.deepStrictEqual(
        BUCKET_CONFIGS["text-embedding-004"],
        { rpm: 50, concurrency: 10 },
        "T5 FAIL: text-embedding-004 must be { rpm: 50, concurrency: 10 }",
    );
    console.log("[PASS] T5: text-embedding-004 → { rpm: 50, concurrency: 10 } (unchanged)");

    // T6: unknown model absent from BUCKET_CONFIGS (falls back to DEFAULT_CONFIG at runtime)
    assert.strictEqual(
        BUCKET_CONFIGS["unknown-model-xyz"],
        undefined,
        "T6 FAIL: unknown models must not appear in BUCKET_CONFIGS",
    );
    console.log("[PASS] T6: unknown-model-xyz is absent from BUCKET_CONFIGS");

    // T7: DEFAULT_CONFIG itself unchanged
    assert.deepStrictEqual(
        DEFAULT_CONFIG,
        { rpm: 15, concurrency: 3 },
        "T7 FAIL: DEFAULT_CONFIG must remain { rpm: 15, concurrency: 3 }",
    );
    console.log("[PASS] T7: DEFAULT_CONFIG → { rpm: 15, concurrency: 3 } (unchanged)");

    console.log("\n=== All 7 BUCKET_CONFIGS regression assertions PASSED ===");
}

try {
    runTests();
    process.exit(0);
} catch (err) {
    console.error("\n[FAIL]", err instanceof Error ? err.message : String(err));
    process.exit(1);
}
