import { describe, expect, test } from "bun:test";
import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { runConfirmTokenFlow } from "../handlers/confirm-token-flow";

// Pins the "fail-loud when ctx.redis is missing" branch. Without this
// test, a refactor that accidentally drops the redis check would not
// trip any CI — the remaining assertions (single-use, retry, cross-
// purpose) all run against a wired Redis and would pass regardless.

function fakeCtxWithoutRedis(): HandlerContext {
  // Minimal fake ctx for the specific branch under test — the flow
  // returns before touching any other ctx field. `as unknown as` is the
  // established pattern for test-only fakes at system boundaries.
  return { redis: undefined } as unknown as HandlerContext;
}

function invalidTokenStub() {
  return writeFailure(
    new UnprocessableError("invalid_token", {
      i18nKey: "invalid_token",
    }),
  );
}

describe("runConfirmTokenFlow — ctx.redis missing", () => {
  test("returns InternalError with the feature-supplied message", async () => {
    const result = await runConfirmTokenFlow(
      fakeCtxWithoutRedis(),
      "11111111-1111-4111-8111-111111111111",
      Date.now() + 60_000,
      {
        purpose: "reset",
        redisRequiredMessage: "password-reset requires redis",
        invalidToken: invalidTokenStub,
        buildChanges: async () => ({ passwordHash: "new" }),
        successData: { kind: "password-reset" as const },
      },
    );

    expect(result.isSuccess).toBe(false);
    if (result.isSuccess) throw new Error("expected failure");
    // InternalError surfaces as 500 at the HTTP layer; for this test
    // we just pin that it carries the feature-specific message so a
    // caller operator log can distinguish reset vs verify misconfigs.
    expect(result.error.message).toContain("password-reset requires redis");
  });

  test("message is forwarded verbatim — no framework-level rewording", async () => {
    const result = await runConfirmTokenFlow(
      fakeCtxWithoutRedis(),
      "22222222-2222-4222-8222-222222222222",
      Date.now() + 60_000,
      {
        purpose: "verify",
        redisRequiredMessage: "email-verification requires redis",
        invalidToken: invalidTokenStub,
        buildChanges: async () => ({ emailVerified: true }),
        successData: { kind: "verified" as const },
      },
    );

    expect(result.isSuccess).toBe(false);
    if (result.isSuccess) throw new Error("expected failure");
    expect(result.error.message).toContain("email-verification requires redis");
  });
});
