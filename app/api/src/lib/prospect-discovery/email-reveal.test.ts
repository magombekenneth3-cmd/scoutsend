import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { inferAndApplyPatternFromSibling } from "./shared";
import { isExpectedLeadDuplicate } from "../../modules/gemini/discoveryLib/discovery";
import { Prisma } from "@prisma/client";

describe("Email Reveal & Discovery Correctness Regression Tests", () => {
  test("Test A — Sibling pattern inference generates target email, not sibling email", () => {
    const siblingEmail = "jane.doe@acme.com";
    const siblingFirstName = "Jane";
    const siblingLastName = "Doe";

    const targetFirstName = "John";
    const targetLastName = "Smith";
    const domain = "acme.com";

    const candidate = inferAndApplyPatternFromSibling(
      siblingEmail,
      siblingFirstName,
      siblingLastName,
      targetFirstName,
      targetLastName,
      domain
    );

    assert.notEqual(candidate, "jane.doe@acme.com", "Must not return sibling email");
    assert.equal(candidate, "john.smith@acme.com", "Must generate target email using inferred first.last pattern");
  });

  test("Test B — Sibling pattern with first-initial pattern", () => {
    const siblingEmail = "jdoe@acme.com";
    const siblingFirstName = "Jane";
    const siblingLastName = "Doe";

    const targetFirstName = "John";
    const targetLastName = "Smith";
    const domain = "acme.com";

    const candidate = inferAndApplyPatternFromSibling(
      siblingEmail,
      siblingFirstName,
      siblingLastName,
      targetFirstName,
      targetLastName,
      domain
    );

    assert.equal(candidate, "jsmith@acme.com");
  });

  test("Test C — isExpectedLeadDuplicate matches email or externalId unique constraints", () => {
    const emailErr = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "5.0.0",
      meta: { target: ["campaignId", "email"] },
    });

    const externalIdErr = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "5.0.0",
      meta: { target: ["campaignId", "externalId"] },
    });

    const otherErr = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "5.0.0",
      meta: { target: ["slug"] },
    });

    const randomErr = new Error("General error");

    assert.equal(isExpectedLeadDuplicate(emailErr), true);
    assert.equal(isExpectedLeadDuplicate(externalIdErr), true);
    assert.equal(isExpectedLeadDuplicate(otherErr), false);
    assert.equal(isExpectedLeadDuplicate(randomErr), false);
  });
});
