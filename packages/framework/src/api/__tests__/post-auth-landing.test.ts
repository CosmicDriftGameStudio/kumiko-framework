import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  isSafeLandingPath,
  type PostAuthLandingArgs,
  resolvePostAuthLandingPath,
} from "../post-auth-landing";

describe("isSafeLandingPath", () => {
  const rejected: unknown[] = [
    "//evil.com",
    "/\\evil.com",
    "/a\\b",
    "/\t/evil.com",
    "/\n/evil.com",
    " /a",
    "https://evil.com",
    "javascript:alert(1)",
    "",
    "a/b",
    42,
    undefined,
    "/.//evil.com",
  ];
  for (const candidate of rejected) {
    test(`rejects ${JSON.stringify(candidate)}`, () => {
      expect(isSafeLandingPath(candidate)).toBe(false);
    });
  }

  const accepted: string[] = ["/", "/a/profile", "/a/vehicle-detail/abc?x=1#h"];
  for (const candidate of accepted) {
    test(`accepts ${JSON.stringify(candidate)}`, () => {
      expect(isSafeLandingPath(candidate)).toBe(true);
    });
  }
});

describe("resolvePostAuthLandingPath", () => {
  const args: PostAuthLandingArgs = { flow: "login", roles: ["User"], tenantId: "t1" };
  const realWarn = console.warn;

  beforeEach(() => {
    console.warn = mock(() => {});
  });
  afterEach(() => {
    console.warn = realWarn;
  });

  test("undefined resolver → undefined, no warning", () => {
    expect(resolvePostAuthLandingPath(undefined, args)).toBeUndefined();
    expect(console.warn).not.toHaveBeenCalled();
  });

  test("resolver returns undefined → undefined, no warning", () => {
    expect(resolvePostAuthLandingPath(() => undefined, args)).toBeUndefined();
    expect(console.warn).not.toHaveBeenCalled();
  });

  test("throwing resolver → undefined, logs a warning without the thrown value", () => {
    const result = resolvePostAuthLandingPath(() => {
      throw new Error("boom");
    }, args);
    expect(result).toBeUndefined();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  test("unsafe path → undefined, warns without leaking the candidate", () => {
    const result = resolvePostAuthLandingPath(() => "//evil.com", args);
    expect(result).toBeUndefined();
    expect(console.warn).toHaveBeenCalledTimes(1);
    const loggedArgs = (console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(JSON.stringify(loggedArgs)).not.toContain("evil.com");
  });

  test("valid path → the path, no warning", () => {
    expect(resolvePostAuthLandingPath(() => "/a/profile", args)).toBe("/a/profile");
    expect(console.warn).not.toHaveBeenCalled();
  });
});
