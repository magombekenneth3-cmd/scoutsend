import test from "node:test";
import assert from "node:assert/strict";

import { createResearchRunLimiters } from "./gemini.agent";

test("createResearchRunLimiters returns independent limiters per run", () => {
  const first = createResearchRunLimiters();
  const second = createResearchRunLimiters();

  assert.notStrictEqual(first.places, second.places);
  assert.notStrictEqual(first.serper, second.serper);
  assert.notStrictEqual(first.scoring, second.scoring);
  assert.notStrictEqual(first.persist, second.persist);
});
