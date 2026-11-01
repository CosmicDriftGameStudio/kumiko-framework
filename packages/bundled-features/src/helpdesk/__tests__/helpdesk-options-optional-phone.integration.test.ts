import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { HelpdeskHandlers } from "../web/constants.ts";
import {
  loadRequests,
  postSubmit,
  seedAdmin,
  seedReporter,
  submitBody,
} from "./helpdesk-helpers.ts";
import {
  createHelpdeskTestStack,
  type HelpdeskTestStack,
  resetHelpdeskTestState,
} from "./helpdesk-test-stack.ts";

let ctx: HelpdeskTestStack;

beforeAll(async () => {
  resetPiiSubjectKmsForTests();
  ctx = await createHelpdeskTestStack({ fields: { phone: "optional" } });
});

afterAll(async () => {
  ctx.telegram.stop();
  await ctx.stack.cleanup();
});

beforeEach(async () => {
  await resetHelpdeskTestState(ctx);
  await seedAdmin(ctx.stack, "admin1@example.com");
});

describe("helpdesk with optional phone", () => {
  test("a submit works with and without a phone number", async () => {
    const without = await postSubmit(ctx.stack, await submitBody(ctx.stack));
    const withPhone = await postSubmit(
      ctx.stack,
      await submitBody(ctx.stack, { phone: "+49 30 1234567" }),
    );
    expect(without.status).toBe(200);
    expect(withPhone.status).toBe(200);
    expect(await loadRequests(ctx.stack)).toHaveLength(2);
  });

  test("an admin report works with and without a phone number", async () => {
    const reporter = await seedReporter(ctx.stack, "rita@example.com");
    const report = { kind: "bug", subject: "Crash", message: "It crashes." };
    await ctx.stack.http.writeOk(HelpdeskHandlers.report, report, reporter);
    await ctx.stack.http.writeOk(
      HelpdeskHandlers.report,
      { ...report, phone: "+49 30 1234567" },
      reporter,
    );
    const phones = (await loadRequests(ctx.stack)).map((row) => row["phone"] ?? null);
    expect(phones).toHaveLength(2);
    expect(phones).toContain("+49 30 1234567");
    expect(phones).toContain(null);
  });
});
