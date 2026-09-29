/**
 * generate-banned-phrases.test.ts
 *
 * Pure regression script for the surgical banned-phrase matching fix
 * in generate.agent.ts (Finding 7, State-3).
 *
 * Tests the following invariants:
 *   T1  exact "leverage" (single word) matches → count increments
 *   T2  "leveraged" does NOT match "leverage" (false positive eliminated)
 *   T3  exact "synergies" (single word) matches → count increments
 *   T4  "synergistic" does NOT match "synergies"
 *   T5  "I hope you\u2019re doing well" (curly apostrophe U+2019) matches
 *       "I hope you're doing well" after normalization
 *   T6  "game-changing" (hyphenated multi-word) still matches
 *   T7  "all-in-one platform" (hyphenated multi-word) still matches
 *   T8  clean text containing none of the banned corpus returns 0
 *
 * Pure logic — no LLM, no DB, no Redis.
 * Uses process.exit() for CJS/tsx compatibility (no mock.module needed).
 */
import assert from "node:assert/strict";

// ─── Inline the implementation under test ──────────────────────────────────
// These constants and functions are exact copies of the patched production
// code in generate.agent.ts. If the production implementation changes, this
// test must be updated in lockstep.

const BANNED_PHRASES: string[] = [
    "I hope you're doing well",
    "I came across your company",
    "I was impressed by",
    "exciting news",
    "innovative platform",
    "game-changing",
    "cutting-edge",
    "help companies like yours",
    "optimize your growth",
    "drive meaningful results",
    "unlock growth",
    "accelerate your growth",
    "leverage",
    "synergies",
    "data-driven approach",
    "tailored solutions",
    "I'd love to connect",
    "worth a brief call?",
    "I hope this finds you well",
    "reach out",
    "all-in-one platform",
    "streamline workflows",
    "maximize engagement",
    "cut through the noise",
    "drive pipeline",
    "scalable solution",
    "hope this email finds you well",
    "circle back",
    "touch base",
];

const SINGLE_WORD_PHRASES = new Set(["leverage", "synergies"]);
const APOSTROPHE_RE = /[\u2018\u2019\u2032]/g;

function normalizeBannedText(s: string): string {
    return s.toLowerCase().replace(APOSTROPHE_RE, "'");
}

function countBannedPhrases(text: string): number {
    const lower = normalizeBannedText(text);
    return BANNED_PHRASES.reduce((count, phrase) => {
        const normalizedPhrase = normalizeBannedText(phrase);
        if (SINGLE_WORD_PHRASES.has(normalizedPhrase)) {
            return new RegExp(`\\b${normalizedPhrase}\\b`, "i").test(lower) ? count + 1 : count;
        }
        return lower.includes(normalizedPhrase) ? count + 1 : count;
    }, 0);
}

// ─── Tests ─────────────────────────────────────────────────────────────────

function runTests(): void {
    // T1: exact "leverage" (single word) — must match
    assert.strictEqual(
        countBannedPhrases("We help teams leverage existing workflows."),
        1,
        "T1 FAIL: exact 'leverage' must be detected",
    );
    console.log("[PASS] T1: exact 'leverage' matches");

    // T2: "leveraged" — must NOT match "leverage" (false positive eliminated)
    assert.strictEqual(
        countBannedPhrases("The company used a leveraged buyout to acquire the firm."),
        0,
        "T2 FAIL: 'leveraged' must NOT match the banned word 'leverage'",
    );
    console.log("[PASS] T2: 'leveraged' does NOT match 'leverage'");

    // T3: exact "synergies" — must match
    assert.strictEqual(
        countBannedPhrases("This deal creates synergies across both portfolios."),
        1,
        "T3 FAIL: exact 'synergies' must be detected",
    );
    console.log("[PASS] T3: exact 'synergies' matches");

    // T4: "synergistic" — must NOT match "synergies"
    assert.strictEqual(
        countBannedPhrases("Their teams have a synergistic working relationship."),
        0,
        "T4 FAIL: 'synergistic' must NOT match the banned word 'synergies'",
    );
    console.log("[PASS] T4: 'synergistic' does NOT match 'synergies'");

    // T5: curly apostrophe (U+2019) normalization — must match as true positive
    assert.strictEqual(
        countBannedPhrases("I hope you\u2019re doing well and had a great weekend."),
        1,
        "T5 FAIL: curly apostrophe U+2019 in 'you\u2019re' must normalize and match banned phrase",
    );
    console.log("[PASS] T5: curly apostrophe 'you\u2019re' normalizes and matches 'you're'");

    // T6: "game-changing" (hyphenated) — String.includes() preserved, must still match
    assert.strictEqual(
        countBannedPhrases("This is a game-changing solution for your team."),
        1,
        "T6 FAIL: hyphenated 'game-changing' must still be detected",
    );
    console.log("[PASS] T6: 'game-changing' (hyphenated) still matches");

    // T7: "all-in-one platform" (hyphenated multi-word) — must still match
    assert.strictEqual(
        countBannedPhrases("Our all-in-one platform handles every workflow."),
        1,
        "T7 FAIL: 'all-in-one platform' must still be detected",
    );
    console.log("[PASS] T7: 'all-in-one platform' (hyphenated multi-word) still matches");

    // T8: clean text — must return 0
    assert.strictEqual(
        countBannedPhrases("Hi Sarah, I noticed your team recently expanded into the enterprise segment. Curious whether that shift has changed how you think about onboarding velocity."),
        0,
        "T8 FAIL: clean email text must return 0 banned phrase count",
    );
    console.log("[PASS] T8: clean text returns 0");

    // Bonus T9: multiple banned phrases in one body — count must be additive
    assert.strictEqual(
        countBannedPhrases("leverage synergies and circle back."),
        3,
        "T9 FAIL: three banned phrases in one body must return count=3",
    );
    console.log("[PASS] T9: multiple banned phrases are additive");

    console.log("\n=== All 9 banned-phrase regression assertions PASSED ===");
}

try {
    runTests();
    process.exit(0);
} catch (err) {
    console.error("\n[FAIL]", err instanceof Error ? err.message : String(err));
    process.exit(1);
}
