import { describe, expect, test } from "bun:test";
import { UnconfiguredError, UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";
import {
  assertRedirectOrigins,
  isNonEmptyStringArray,
  isOwnProviderCustomer,
  joinBaseUrl,
} from "../checkout-core";
import type { SubscriptionView } from "../get-subscription-for-tenant";

function subscriptionView(overrides: Partial<SubscriptionView> = {}): SubscriptionView {
  return {
    tier: "pro",
    status: "canceled",
    providerName: "mock",
    providerCustomerId: "cus_own",
    providerSubscriptionId: "sub_own",
    ...overrides,
  };
}

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

describe("isOwnProviderCustomer", () => {
  test("false when the tenant has no subscription at all", () => {
    expect(isOwnProviderCustomer(null, "mock", "cus_own")).toBe(false);
  });

  test("false for a subscription at a different provider", () => {
    expect(
      isOwnProviderCustomer(subscriptionView({ providerName: "stripe" }), "mock", "cus_own"),
    ).toBe(false);
  });

  test("false for a different customer id at the same provider", () => {
    expect(isOwnProviderCustomer(subscriptionView(), "mock", "cus_other_tenant")).toBe(false);
  });

  test("true for the tenant's own customer id at the same provider, even canceled", () => {
    expect(isOwnProviderCustomer(subscriptionView(), "mock", "cus_own")).toBe(true);
  });
});
