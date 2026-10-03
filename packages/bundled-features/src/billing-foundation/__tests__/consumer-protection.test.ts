import { describe, expect, test } from "bun:test";
import {
  CONSENT_TEXTS,
  consentTextVersion,
  resolveConsentLocale,
} from "../consumer-protection/consent-text.js";
import { createBillingFoundationFeature } from "../feature.js";
import type { ConsumerProtectionOptions } from "../types.js";

function options(overrides: Partial<ConsumerProtectionOptions> = {}): ConsumerProtectionOptions {
  return {
    termsTextBlock: "billing-terms",
    vatNote: { de: "inkl. USt.", en: "incl. VAT" },
    operatorEmail: "billing@example.com",
    legalLinks: { terms: "/terms", withdrawal: "/withdrawal", privacy: "https://example.com/p" },
    ...overrides,
  };
}

function create(consumerProtection: ConsumerProtectionOptions, baseUrl?: string) {
  return () =>
    createBillingFoundationFeature({
      ...(baseUrl !== undefined && { baseUrl }),
      consumerProtection,
    });
}

describe("consent text", () => {
  test("version is 16 hex chars, stable, and differs per locale", () => {
    expect(consentTextVersion("de")).toMatch(/^[0-9a-f]{16}$/);
    expect(consentTextVersion("de")).toBe(consentTextVersion("de"));
    expect(consentTextVersion("de")).not.toBe(consentTextVersion("en"));
  });

  test("every locale carries all four texts", () => {
    for (const texts of Object.values(CONSENT_TEXTS)) {
      for (const text of Object.values(texts)) expect(text.length).toBeGreaterThan(20);
    }
  });

  test("locale resolution: exact, language part, fallback de", () => {
    expect(resolveConsentLocale("en")).toBe("en");
    expect(resolveConsentLocale("EN-gb")).toBe("en");
    expect(resolveConsentLocale("de-AT")).toBe("de");
    expect(resolveConsentLocale("fr")).toBe("de");
    expect(resolveConsentLocale(undefined)).toBe("de");
  });
});

describe("consumerProtection option validation", () => {
  const base = "https://app.example.com";

  test("accepts a complete configuration", () => {
    expect(create(options(), base)).not.toThrow();
  });

  test("requires baseUrl", () => {
    expect(create(options())).toThrow(/consumerProtection requires baseUrl/);
  });

  test("rejects an empty termsTextBlock", () => {
    expect(create(options({ termsTextBlock: " " }), base)).toThrow(/termsTextBlock/);
  });

  test("requires de and en VAT notes", () => {
    expect(create(options({ vatNote: { de: "x" } }), base)).toThrow(/"en"/);
    expect(create(options({ vatNote: { en: "x" } }), base)).toThrow(/"de"/);
  });

  test("rejects an invalid operator email", () => {
    expect(create(options({ operatorEmail: "not-an-email" }), base)).toThrow(/operatorEmail/);
  });

  test("legal links must be root-relative or https", () => {
    for (const bad of [
      "//evil.example/x",
      "http://example.com/x",
      "terms",
      "javascript:alert(1)",
    ]) {
      expect(
        create(options({ legalLinks: { terms: bad, withdrawal: "/w", privacy: "/p" } }), base),
      ).toThrow(/legalLinks\.terms/);
    }
  });
});
