import { describe, expect, it } from "bun:test";
import {
  DEFAULT_SENSITIVE_CONFIG,
  mergeSensitiveConfig,
  REDACTED,
  redactAttributes,
  shouldRedactAttribute,
} from "../sensitive-filter.ts";

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
    const { redactValue } = await import("../sensitive-filter.ts");
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
