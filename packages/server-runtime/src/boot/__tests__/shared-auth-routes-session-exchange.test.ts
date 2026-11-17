import { describe, expect, test } from "bun:test";
import { buildSharedAuthRoutes } from "../shared-boot-steps.ts";

describe("buildSharedAuthRoutes with sessionExchangeHandlers", () => {
  const handlers = { code: "demo-exchange:write:code" };

  test("aborts boot when auth-mfa is mounted", () => {
    expect(() => buildSharedAuthRoutes({ sessionExchangeHandlers: handlers }, true)).toThrow(
      /session-exchange handlers cannot enforce MFA yet/,
    );
  });

  test("passes the handlers through without auth-mfa", () => {
    expect(buildSharedAuthRoutes({ sessionExchangeHandlers: handlers }, false)).toMatchObject({
      sessionExchangeHandlers: handlers,
    });
  });

  test("auth-mfa with no or empty handlers is fine", () => {
    expect(() => buildSharedAuthRoutes({}, true)).not.toThrow();
    expect(() => buildSharedAuthRoutes({ sessionExchangeHandlers: {} }, true)).not.toThrow();
  });
});
