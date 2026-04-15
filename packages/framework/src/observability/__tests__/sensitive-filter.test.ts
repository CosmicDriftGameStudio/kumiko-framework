import { describe, expect, it } from "vitest";
import {
  DEFAULT_SENSITIVE_CONFIG,
  REDACTED,
  mergeSensitiveConfig,
  redactAttributes,
  redactHeaders,
  redactQueryString,
  shouldRedactAttribute,
} from "../sensitive-filter";

describe("redactHeaders", () => {
  it("redacts default sensitive headers case-insensitive", () => {
    const result = redactHeaders(
      {
        Authorization: "Bearer abc",
        Cookie: "session=xyz",
        "X-API-Key": "secret",
        "X-Request-ID": "req-123",
        "Content-Type": "application/json",
      },
      DEFAULT_SENSITIVE_CONFIG,
    );
    expect(result["Authorization"]).toBe(REDACTED);
    expect(result["Cookie"]).toBe(REDACTED);
    expect(result["X-API-Key"]).toBe(REDACTED);
    expect(result["X-Request-ID"]).toBe("req-123");
    expect(result["Content-Type"]).toBe("application/json");
  });

  it("keeps other headers unchanged", () => {
    const result = redactHeaders(
      { "user-agent": "Mozilla" },
      DEFAULT_SENSITIVE_CONFIG,
    );
    expect(result["user-agent"]).toBe("Mozilla");
  });
});

describe("redactQueryString", () => {
  it("redacts tokens in path+query form", () => {
    const result = redactQueryString(
      "/api/callback?token=abc&user=bob",
      DEFAULT_SENSITIVE_CONFIG,
    );
    expect(result).toContain(`token=${encodeURIComponent(REDACTED)}`);
    expect(result).toContain("user=bob");
  });

  it("handles absolute URLs", () => {
    const result = redactQueryString(
      "https://example.com/oauth?access_token=xyz&state=ok",
      DEFAULT_SENSITIVE_CONFIG,
    );
    expect(result).toContain(`access_token=${encodeURIComponent(REDACTED)}`);
    expect(result).toContain("state=ok");
  });

  it("preserves path and fragment", () => {
    const result = redactQueryString(
      "/path/to/thing?password=x#section",
      DEFAULT_SENSITIVE_CONFIG,
    );
    expect(result.startsWith("/path/to/thing")).toBe(true);
    expect(result.endsWith("#section")).toBe(true);
  });
});

describe("shouldRedactAttribute + redactAttributes", () => {
  it("matches password-like keys case-insensitive", () => {
    expect(shouldRedactAttribute("user.password", DEFAULT_SENSITIVE_CONFIG)).toBe(true);
    expect(shouldRedactAttribute("apiToken", DEFAULT_SENSITIVE_CONFIG)).toBe(true);
    expect(shouldRedactAttribute("SessionId", DEFAULT_SENSITIVE_CONFIG)).toBe(true);
    expect(shouldRedactAttribute("orderCount", DEFAULT_SENSITIVE_CONFIG)).toBe(false);
  });

  it("redacts sensitive attribute keys", () => {
    const out = redactAttributes(
      { "user.password": "hunter2", "user.id": 42, privateKey: "-----" },
      DEFAULT_SENSITIVE_CONFIG,
    );
    // Strings redact to REDACTED marker, numbers/booleans redact type-preserving.
    expect(out["user.password"]).toBe(REDACTED);
    expect(out["privateKey"]).toBe(REDACTED);
    expect(out["user.id"]).toBe(42);
  });

  it("redactValue preserves type while neutralising the value", async () => {
    const { redactValue } = await import("../sensitive-filter");
    expect(redactValue("secret")).toBe(REDACTED);
    expect(redactValue(42)).toBe(0);
    expect(redactValue(true)).toBe(false);
    expect(redactValue(false)).toBe(false);
  });
});

describe("mergeSensitiveConfig", () => {
  it("returns default when override is undefined", () => {
    expect(mergeSensitiveConfig(undefined)).toBe(DEFAULT_SENSITIVE_CONFIG);
  });

  it("merges partial overrides", () => {
    const merged = mergeSensitiveConfig({ redactedHeaders: ["x-custom"] });
    expect(merged.redactedHeaders).toEqual(["x-custom"]);
    expect(merged.redactedQueryParams).toBe(DEFAULT_SENSITIVE_CONFIG.redactedQueryParams);
  });
});
