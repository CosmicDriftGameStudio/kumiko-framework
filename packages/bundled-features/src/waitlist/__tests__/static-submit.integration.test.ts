import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { routeFetchToStack } from "../../shared/__tests__/fetch-test-utils.ts";
import { waitlistEntryTable } from "../entity.ts";
import { submitToWaitlist } from "../static-submit.ts";
import { createWaitlistTestStack, mailsTo, resetWaitlistTestState } from "./waitlist-test-stack.ts";

const realFetch = globalThis.fetch;
let stack: TestStack;

beforeAll(async () => {
  stack = await createWaitlistTestStack({ appName: "Acme" });
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await stack.cleanup();
});

beforeEach(async () => {
  await resetWaitlistTestState(stack);
  routeFetchToStack(stack);
});

describe("submitToWaitlist against the real stack", () => {
  test("registers the entry and sends the confirmation mail", async () => {
    const result = await submitToWaitlist({
      name: "Ada Lovelace",
      email: "ada@static.test",
      company: "",
      message: "Hello",
      locale: "en",
      website: "",
    });

    expect(result).toEqual({ kind: "success", data: undefined });
    const rows = await selectMany(stack.db, waitlistEntryTable, { email: "ada@static.test" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Ada Lovelace", message: "Hello", status: "pending" });
    expect(mailsTo("ada@static.test")).toHaveLength(1);
  });

  test("a filled honeypot reads as success but stores nothing", async () => {
    const result = await submitToWaitlist({
      name: "Bot",
      email: "bot@static.test",
      locale: "en",
      website: "https://spam.example",
    });

    expect(result.kind).toBe("success");
    expect(
      await selectMany(stack.db, waitlistEntryTable, { email: "bot@static.test" }),
    ).toHaveLength(0);
  });

  test("an invalid address is a failure", async () => {
    const result = await submitToWaitlist({ name: "X", email: "not-an-email", locale: "en" });

    expect(result).toMatchObject({ kind: "failure", reason: "validation_error" });
  });
});
