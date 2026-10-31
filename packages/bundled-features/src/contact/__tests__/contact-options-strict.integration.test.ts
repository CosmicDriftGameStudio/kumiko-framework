import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { loadRequests, postSubmit, seedAdmin, submitBody } from "./contact-helpers.ts";
import {
  type ContactTestStack,
  createContactTestStack,
  resetContactTestState,
} from "./contact-test-stack.ts";

let ctx: ContactTestStack;

beforeAll(async () => {
  resetPiiSubjectKmsForTests();
  // Default minSubmitSeconds (3) stays in force; only the proof-of-work cost is lowered.
  ctx = await createContactTestStack({
    spamProtection: { proofOfWorkBits: 8 },
    fields: { phone: "required" },
  });
});

afterAll(async () => {
  ctx.telegram.stop();
  await ctx.stack.cleanup();
});

beforeEach(async () => {
  await resetContactTestState(ctx);
  await seedAdmin(ctx.stack, "admin1@example.com");
});

describe("contact with default spam timing and required phone", () => {
  test("a submit right after the challenge is silently dropped", async () => {
    const res = await postSubmit(
      ctx.stack,
      await submitBody(ctx.stack, { phone: "+49 30 1234567" }),
    );
    expect(res.status).toBe(200);
    expect(await loadRequests(ctx.stack)).toHaveLength(0);
  });
});
