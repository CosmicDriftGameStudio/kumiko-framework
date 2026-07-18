import { describe, expect, test } from "bun:test";
import { passwordPairIssue, resolveLoggedInHref, retryAfterMinutes } from "../auth-form-logic";

describe("passwordPairIssue", () => {
  test("too_short when under min length", () => {
    expect(passwordPairIssue("short", "short")).toBe("too_short");
  });

  test("mismatch when confirm differs", () => {
    expect(passwordPairIssue("validpass1", "otherpass1")).toBe("mismatch");
  });

  test("null when both valid and matching", () => {
    expect(passwordPairIssue("validpass1", "validpass1")).toBeNull();
  });

  test("custom minLength", () => {
    expect(passwordPairIssue("123456", "123456", 6)).toBeNull();
    expect(passwordPairIssue("12345", "12345", 6)).toBe("too_short");
  });
});

describe("retryAfterMinutes", () => {
  test("undefined in → undefined out", () => {
    expect(retryAfterMinutes(undefined)).toBeUndefined();
  });

  test("ceils fractional minutes", () => {
    expect(retryAfterMinutes(1)).toBe(1);
    expect(retryAfterMinutes(60)).toBe(1);
    expect(retryAfterMinutes(61)).toBe(2);
    expect(retryAfterMinutes(540)).toBe(9);
  });
});

describe("resolveLoggedInHref", () => {
  test("string href returned as-is", () => {
    expect(resolveLoggedInHref("/", "acme")).toBe("/");
  });

  test("function href receives tenantKey", () => {
    expect(resolveLoggedInHref(({ tenantKey }) => `/${tenantKey}/`, "acme")).toBe("/acme/");
  });
});
