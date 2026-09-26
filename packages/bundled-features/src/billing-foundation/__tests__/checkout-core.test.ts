import { describe, expect, test } from "bun:test";
import { UnconfiguredError, UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";
import { assertRedirectOrigins, isNonEmptyStringArray, joinBaseUrl } from "../checkout-core";

describe("assertRedirectOrigins", () => {
  test("throws UnconfiguredError when baseUrl is undefined, regardless of urls", () => {
    expect(() => assertRedirectOrigins(["https://example.com/success"], undefined)).toThrow(
      UnconfiguredError,
    );
  });

  test("throws UnconfiguredError when baseUrl is not a parseable absolute URL", () => {
    expect(() => assertRedirectOrigins(["https://example.com/success"], "not-a-url")).toThrow(
      UnconfiguredError,
    );
  });

  test("passes when every url shares baseUrl's origin", () => {
    expect(() =>
      assertRedirectOrigins(
        ["https://example.com/success", "https://example.com/cancel"],
        "https://example.com",
      ),
    ).not.toThrow();
  });

  test("passes when baseUrl carries a path prefix — only the origin is compared", () => {
    expect(() =>
      assertRedirectOrigins(["https://example.com/success"], "https://example.com/tenant-x"),
    ).not.toThrow();
  });

  test("throws UnprocessableError('redirect_origin_not_allowed') for a different origin", () => {
    expect(() =>
      assertRedirectOrigins(["https://attacker.example/success"], "https://example.com"),
    ).toThrow(UnprocessableError);
  });

  test("throws UnprocessableError for a lookalike host that merely starts with baseUrl's host", () => {
    expect(() =>
      assertRedirectOrigins(["https://example.com.evil.com/success"], "https://example.com"),
    ).toThrow(UnprocessableError);
  });

  test("throws UnprocessableError for a different scheme on an otherwise-matching host", () => {
    expect(() =>
      assertRedirectOrigins(["http://example.com/success"], "https://example.com"),
    ).toThrow(UnprocessableError);
  });

  test("throws UnprocessableError for a different port", () => {
    expect(() =>
      assertRedirectOrigins(["https://example.com:8443/success"], "https://example.com"),
    ).toThrow(UnprocessableError);
  });

  test("throws UnprocessableError for a url that isn't a parseable absolute URL", () => {
    expect(() => assertRedirectOrigins(["/relative/path"], "https://example.com")).toThrow(
      UnprocessableError,
    );
  });

  test("empty urls list never throws, even with baseUrl set", () => {
    expect(() => assertRedirectOrigins([], "https://example.com")).not.toThrow();
  });
});

describe("joinBaseUrl", () => {
  test("concatenates baseUrl and path as-is when baseUrl has no trailing slash", () => {
    expect(joinBaseUrl("https://app.example.com", "/billing/success")).toBe(
      "https://app.example.com/billing/success",
    );
  });

  test("strips a trailing slash on baseUrl so the result never becomes protocol-relative", () => {
    expect(joinBaseUrl("https://app.example.com/", "/billing/success")).toBe(
      "https://app.example.com/billing/success",
    );
  });

  test("preserves a path-prefix baseUrl (tenant subdirectory)", () => {
    expect(joinBaseUrl("https://app.example.com/tenant-x", "/billing/success")).toBe(
      "https://app.example.com/tenant-x/billing/success",
    );
  });

  test("preserves a path-prefix baseUrl with a trailing slash, without doubling the slash", () => {
    expect(joinBaseUrl("https://app.example.com/tenant-x/", "/billing/success")).toBe(
      "https://app.example.com/tenant-x/billing/success",
    );
  });
});

describe("isNonEmptyStringArray", () => {
  test("true for a non-empty array", () => {
    expect(isNonEmptyStringArray(["pro"])).toBe(true);
  });

  test("false for an empty array", () => {
    expect(isNonEmptyStringArray([])).toBe(false);
  });
});
