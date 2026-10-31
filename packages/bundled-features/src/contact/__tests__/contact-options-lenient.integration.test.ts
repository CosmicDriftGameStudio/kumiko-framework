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
  ctx = await createContactTestStack({ fields: { phone: "required" }, emailRateLimits: [] });
});

afterAll(async () => {
  ctx.telegram.stop();
  await ctx.stack.cleanup();
});

beforeEach(async () => {
  await resetContactTestState(ctx);
  await seedAdmin(ctx.stack, "admin1@example.com");
});

describe("contact with required phone and no per-email limit", () => {
  test("a submit without phone is refused", async () => {
    const res = await postSubmit(ctx.stack, await submitBody(ctx.stack));
    expect(res.status).toBe(422);
    expect(await loadRequests(ctx.stack)).toHaveLength(0);
  });

  test("with a phone the request is stored and the phone kept", async () => {
    const res = await postSubmit(
      ctx.stack,
      await submitBody(ctx.stack, { phone: "+49 30 1234567" }),
    );
    expect(res.status).toBe(200);
    const rows = await loadRequests(ctx.stack);
    expect(rows).toHaveLength(1);
  });

  test("the same address can submit more than three times a day", async () => {
    for (let index = 0; index < 4; index++) {
      const res = await postSubmit(
        ctx.stack,
        await submitBody(ctx.stack, { email: "same@example.com", phone: "+49 30 1234567" }),
      );
      expect(res.status).toBe(200);
    }
    expect(await loadRequests(ctx.stack)).toHaveLength(4);
  });
});
