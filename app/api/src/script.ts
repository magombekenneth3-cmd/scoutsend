// scripts/test-linkedin-provider.ts
//
// Run: npx ts-node scripts/test-linkedin-provider.ts
//
// Smoke-tests the Unipile provider against a real account.
// Set the env vars below before running.

import "dotenv/config";
import { UnipileLinkedInProvider } from "./lib/linkedIn/Unipile.provider";
import { LinkedInAccountContext } from "./lib/linkedIn/linkedin.provider";

const TEST_PROFILE_URL =
    process.env.TEST_LINKEDIN_PROFILE_URL ?? "https://www.linkedin.com/in/williamhgates";

const provider = new UnipileLinkedInProvider({
    baseUrl: process.env.UNIPILE_BASE_URL!,
    apiKey: process.env.UNIPILE_API_KEY!,
});

const account: LinkedInAccountContext = {
    accountId: process.env.UNIPILE_TEST_ACCOUNT_ID!,
};

async function run() {
    console.log("\n── 1. health check ──────────────────────────");
    const h = await provider.health(account);
    console.log("  healthy:", h.healthy ? "✅ OK" : "❌ FAILED");
    if (!h.healthy) process.exit(1);

    console.log("\n── 2. checkConnectionStatus ─────────────────");
    const rel = await provider.checkConnectionStatus(account, { profileUrl: TEST_PROFILE_URL });
    console.log("  connected:", rel.connected);
    console.log("  pending:", rel.pending);

    console.log("\n── 3. visitProfile ──────────────────────────");
    const visit = await provider.visitProfile(account, { profileUrl: TEST_PROFILE_URL });
    if ("error" in visit) {
        console.warn("  error:", visit.error.message);
    } else {
        console.log("  success: true, async:", visit.async);
    }

    console.log("\n✅ Smoke tests complete");
}

run().catch((err) => {
    console.error("❌ Test failed:", err);
    process.exit(1);
});