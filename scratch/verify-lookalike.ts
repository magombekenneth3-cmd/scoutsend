import { queueLookalikeSearch } from "../app/api/src/modules/lookalike/lookalike.service";

void (async () => {

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

async function expectError(fn: () => Promise<unknown>): Promise<Error | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    if (err instanceof Error) return err;
    return new Error(String(err));
  }
}

function hasStatusCode(err: Error | null, code: number): boolean {
  if (!err) return false;
  return (err as unknown as { statusCode?: number }).statusCode === code;
}

const VALID_CAMPAIGN_ID = "c" + "x".repeat(24);
const VALID_URLS = ["https://stripe.com", "https://github.com"];

console.log("\n[lookalike.service] queueLookalikeSearch — campaign ID validation");
{
  const err = await expectError(() =>
    queueLookalikeSearch({ campaignId: "bad-id", userId: "user1", clientUrls: VALID_URLS })
  );
  assert("rejects invalid campaign ID with 400", hasStatusCode(err, 400));
}

console.log("\n[lookalike.service] queueLookalikeSearch — clientUrls validation");
{
  const tooFew = await expectError(() =>
    queueLookalikeSearch({ campaignId: VALID_CAMPAIGN_ID, userId: "user1", clientUrls: ["https://stripe.com"] })
  );
  assert("rejects < 2 URLs with 400", hasStatusCode(tooFew, 400));

  const tooMany = await expectError(() =>
    queueLookalikeSearch({
      campaignId: VALID_CAMPAIGN_ID,
      userId: "user1",
      clientUrls: ["https://a.com", "https://b.com", "https://c.com", "https://d.com", "https://e.com", "https://f.com"],
    })
  );
  assert("rejects > 5 URLs with 400", hasStatusCode(tooMany, 400));

  const notArray = await expectError(() =>
    queueLookalikeSearch({ campaignId: VALID_CAMPAIGN_ID, userId: "user1", clientUrls: "https://stripe.com" })
  );
  assert("rejects non-array clientUrls with 400", hasStatusCode(notArray, 400));
}

console.log("\n[lookalike.service] queueLookalikeSearch — SSRF blocking");
{
  const privateErr = await expectError(() =>
    queueLookalikeSearch({
      campaignId: VALID_CAMPAIGN_ID,
      userId: "user1",
      clientUrls: ["http://169.254.169.254/latest/meta-data/", "https://stripe.com"],
    })
  );
  assert("rejects SSRF link-local address", privateErr !== null);

  const localhostErr = await expectError(() =>
    queueLookalikeSearch({
      campaignId: VALID_CAMPAIGN_ID,
      userId: "user1",
      clientUrls: ["http://localhost:8080/admin", "https://stripe.com"],
    })
  );
  assert("rejects localhost URL", localhostErr !== null);

  const privateRangeErr = await expectError(() =>
    queueLookalikeSearch({
      campaignId: VALID_CAMPAIGN_ID,
      userId: "user1",
      clientUrls: ["http://192.168.1.1/", "https://stripe.com"],
    })
  );
  assert("rejects private IP range URL", privateRangeErr !== null);
}

console.log(`\n--- ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);

})();
