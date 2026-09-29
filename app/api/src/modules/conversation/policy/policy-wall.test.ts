import assert from "node:assert/strict";
import { evaluatePolicyWall } from "./policy-wall";

console.log("Running Policy Wall Tests...");

// 1. OPT_OUT beats COMPLAINT & INTENT
{
  const res = evaluatePolicyWall("Not interested, and please remove me from your list.");
  assert.equal(res.action, "OPT_OUT");
  assert.equal(res.deterministic, true);
  assert.equal(res.confidence, 1);
}

// 2. OPT_OUT beats COMPLAINT when both are present
{
  const res = evaluatePolicyWall("Your emails are annoying. Please remove me.");
  assert.equal(res.action, "OPT_OUT");
}

// 3. COMPLAINT beats SNOOZE
{
  const res = evaluatePolicyWall("This is spam! I will report you to my lawyer next month.");
  assert.equal(res.action, "COMPLAINT");
}

// 4. SNOOZE beats ordinary INTENT
{
  const res = evaluatePolicyWall("I'm interested, but contact me next month.");
  assert.equal(res.action, "SNOOZE");
  assert.ok(res.snoozeUntil instanceof Date);
}

// 5. Contraction & Case Normalization
{
  const res = evaluatePolicyWall("DON'T CONTACT ME");
  assert.equal(res.action, "OPT_OUT");
}

// 6. False-Positive Protection
{
  // Legitimate business text mentioning "stop" or "remove" in another context
  const res1 = evaluatePolicyWall("We want to stop data leaks in our infrastructure.");
  assert.equal(res1.action, "CONTINUE_TO_CLASSIFIER");

  const res2 = evaluatePolicyWall("Can you remove obstacles to faster deployment?");
  assert.equal(res2.action, "CONTINUE_TO_CLASSIFIER");
}

// 8. Hardening — Outbound False Positive vs True Opt-Out Discrimination
{
  // Non-Opt-Out / Snooze / Ambiguous cases must NEVER trigger OPT_OUT
  const case1 = evaluatePolicyWall("Not interested right now.");
  assert.notEqual(case1.action, "OPT_OUT", "'Not interested right now.' must NOT be OPT_OUT");
  assert.equal(case1.action, "SNOOZE");

  const case2 = evaluatePolicyWall("Not interested, contact me next quarter.");
  assert.notEqual(case2.action, "OPT_OUT", "'Not interested, contact me next quarter.' must NOT be OPT_OUT");
  assert.equal(case2.action, "SNOOZE");

  const case3 = evaluatePolicyWall("Please don't send pricing yet.");
  assert.equal(case3.action, "CONTINUE_TO_CLASSIFIER", "'Please don't send pricing yet.' must reach classifier");

  const case4 = evaluatePolicyWall("Stop wasting time and send me the information.");
  assert.equal(case4.action, "CONTINUE_TO_CLASSIFIER", "'Stop wasting time...' must reach classifier");

  const case5 = evaluatePolicyWall("Your email went to spam.");
  assert.equal(case5.action, "COMPLAINT", "'Your email went to spam.' must trigger COMPLAINT");

  const case6 = evaluatePolicyWall("Can you stop by next week?");
  assert.notEqual(case6.action, "OPT_OUT", "'Can you stop by next week?' must NOT be OPT_OUT");

  // True Opt-Out cases MUST trigger OPT_OUT
  assert.equal(evaluatePolicyWall("Stop emailing me.").action, "OPT_OUT");
  assert.equal(evaluatePolicyWall("Remove me from your list.").action, "OPT_OUT");
  assert.equal(evaluatePolicyWall("Unsubscribe me.").action, "OPT_OUT");
  assert.equal(evaluatePolicyWall("Do not contact me again.").action, "OPT_OUT");
}

console.log("✅ All Policy Wall Tests Passed Cleanly!");
