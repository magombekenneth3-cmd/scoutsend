import {
  auditMessage,
  checkUnsubscribeFooterPresent,
} from "../app/api/src/modules/gemini/compliance.agent";

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

function hasCodes(violations: { code: string }[], ...codes: string[]): boolean {
  const vCodes = new Set(violations.map((v) => v.code));
  return codes.every((c) => vCodes.has(c));
}

const VALID_BODY =
  "Hi Jane, I noticed Acme Corp recently expanded into EMEA. We help CFOs cut their reporting cycle by 40%. Worth a 15-min call? To unsubscribe, reply with 'unsubscribe'.";
const VALID_SUBJECT = "Quick question about Acme Corp's EMEA expansion";

console.log("\n[compliance.agent] auditMessage — EU GDPR blocking");
{
  const violations = auditMessage(VALID_SUBJECT, VALID_BODY, "DE", undefined, undefined);
  assert("blocks EU lead without consent basis", hasCodes(violations, "gdpr_region_warning"));
  const violations2 = auditMessage(VALID_SUBJECT, VALID_BODY, "DE", "EXPLICIT_CONSENT", undefined);
  assert("allows EU lead with EXPLICIT_CONSENT", !hasCodes(violations2, "gdpr_region_warning"));
  const violations3 = auditMessage(VALID_SUBJECT, VALID_BODY, "DE", "SOME_INVALID_BASIS", undefined);
  assert("blocks EU lead with invalid basis", hasCodes(violations3, "gdpr_region_warning"));
}

console.log("\n[compliance.agent] auditMessage — CASL blocking");
{
  const violations = auditMessage(VALID_SUBJECT, VALID_BODY, "CA", undefined, undefined);
  assert("blocks CA lead without consent basis", hasCodes(violations, "casl_region_warning"));
  const violations2 = auditMessage(VALID_SUBJECT, VALID_BODY, "CA", "EXISTING_BUSINESS_RELATIONSHIP", undefined);
  assert("allows CA lead with EXISTING_BUSINESS_RELATIONSHIP", !hasCodes(violations2, "casl_region_warning"));
}

console.log("\n[compliance.agent] auditMessage — country name normalization");
{
  const violations = auditMessage(VALID_SUBJECT, VALID_BODY, "Germany", undefined, undefined);
  assert("normalizes 'Germany' to DE and blocks", hasCodes(violations, "gdpr_region_warning"));
  const violations2 = auditMessage(VALID_SUBJECT, VALID_BODY, "Canada", undefined, undefined);
  assert("normalizes 'Canada' to CA and blocks", hasCodes(violations2, "casl_region_warning"));
  const violations3 = auditMessage(VALID_SUBJECT, VALID_BODY, "United States", undefined, undefined);
  assert("US leads not blocked", !hasCodes(violations3, "gdpr_region_warning", "casl_region_warning"));
}

console.log("\n[compliance.agent] checkUnsubscribeFooterPresent");
{
  const bodyWithUnsub = "Hello world. To unsubscribe, reply with 'unsubscribe'.";
  const bodyWithout = "Hello world. Have a great day.";
  const footer = "To unsubscribe, reply with 'unsubscribe'.";

  assert("passes when body contains unsubscribe phrase", checkUnsubscribeFooterPresent(bodyWithUnsub, undefined) === null);
  assert("blocks when body missing unsubscribe", checkUnsubscribeFooterPresent(bodyWithout, undefined)?.code === "missing_unsubscribe");
  assert("passes when footer is present verbatim in body", checkUnsubscribeFooterPresent(bodyWithUnsub, footer) === null);
  assert("blocks when footer not verbatim in body", checkUnsubscribeFooterPresent(bodyWithUnsub, "Some other footer text entirely") !== null);
}

console.log("\n[compliance.agent] auditMessage — placeholder blocking");
{
  const violations = auditMessage("[First Name]", VALID_BODY, null, null, undefined);
  assert("blocks unfilled placeholder in subject", hasCodes(violations, "unfilled_placeholder"));
  const violations2 = auditMessage(VALID_SUBJECT, "Hi {{company_name}}, you should opt out.", null, null, undefined);
  assert("blocks unfilled placeholder in body", hasCodes(violations2, "unfilled_placeholder"));
}

console.log("\n[compliance.agent] auditMessage — severity classification");
{
  const tooShort = "Hi. Opt out.";
  const violations = auditMessage(VALID_SUBJECT, tooShort, null, null, undefined);
  const blockViolations = violations.filter((v) => v.severity === "block");
  assert("body_too_short is a block violation", hasCodes(blockViolations, "body_too_short"));
}

console.log(`\n--- ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
