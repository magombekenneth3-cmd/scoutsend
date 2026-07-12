import test from "node:test";
import assert from "node:assert/strict";

import { createReplyPollLimiters } from "./replyPoller";
import { createDeliveryPollLimiters } from "../webhook/deliverypoll";

test("createReplyPollLimiters returns independent limiters per run", () => {
  const first = createReplyPollLimiters();
  const second = createReplyPollLimiters();

  assert.notStrictEqual(first.mailbox, second.mailbox);
});

test("createDeliveryPollLimiters returns independent limiters per run", () => {
  const first = createDeliveryPollLimiters();
  const second = createDeliveryPollLimiters();

  assert.notStrictEqual(first.mailbox, second.mailbox);
});
