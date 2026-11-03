import { describe, expect, test } from "bun:test";
import {
  CONSENT_TEXTS,
  consentTextVersion,
  documentsAcknowledgementTextFor,
  legalLinksFor,
  refundLinkFor,
  resolveConsentLocale,
} from "../consumer-protection/consent-text.ts";
import { createBillingFoundationFeature } from "../feature.ts";
import type { ConsumerProtectionOptions } from "../types.ts";

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

  test("documents text joins the version only when given, per locale and refund variant", () => {
    const withRefund = documentsAcknowledgementTextFor(
      options({
        documentsAcknowledgement: true,
        legalLinks: { terms: "/t", withdrawal: "/w", privacy: "/p", refund: "/r" },
      }),
      "de",
    );
    const withoutRefund = documentsAcknowledgementTextFor(
      options({ documentsAcknowledgement: true }),
      "de",
    );
    expect(withRefund).toContain("Erstattungsrichtlinie");
    expect(withoutRefund).not.toContain("Erstattungsrichtlinie");
    expect(documentsAcknowledgementTextFor(options(), "de")).toBeUndefined();
    expect(consentTextVersion("de", withRefund)).not.toBe(consentTextVersion("de"));
    expect(consentTextVersion("de", withRefund)).not.toBe(consentTextVersion("de", withoutRefund));
  });

  test("the documents checkbox text never asks consent to the privacy policy", () => {
    const legalLinks = { terms: "/t", withdrawal: "/w", privacy: "/p", refund: "/r" };
    for (const locale of ["de", "en"] as const) {
      const withRefund = documentsAcknowledgementTextFor(
        options({ documentsAcknowledgement: true, legalLinks }),
        locale,
      );
      const withoutRefund = documentsAcknowledgementTextFor(
        options({ documentsAcknowledgement: true }),
        locale,
      );
      expect(withRefund).not.toMatch(/Datenschutz|Privacy/i);
      expect(withoutRefund).not.toMatch(/Datenschutz|Privacy/i);
    }
    expect(
      documentsAcknowledgementTextFor(
        options({ documentsAcknowledgement: true, legalLinks }),
        "en",
      ),
    ).toContain("Refund Policy");
    expect(
      documentsAcknowledgementTextFor(options({ documentsAcknowledgement: true }), "en"),
    ).not.toContain("Refund");
  });

  test("the effective refund link is the provider's own, else the global one", () => {
    const set = { terms: "/t", withdrawal: "/w", privacy: "/p" };
    const withProviders = options({
      documentsAcknowledgement: true,
      legalLinks: { ...set, refund: "/global" },
      providerTexts: {
        a: { refundLink: "/a-refund" },
        perLocale: { refundLink: { de: "/de-refund", en: "/en-refund" } },
        b: {},
      },
    });
    expect(refundLinkFor(withProviders, "de", "a")).toBe("/a-refund");
    expect(refundLinkFor(withProviders, "en", "perLocale")).toBe("/en-refund");
    expect(refundLinkFor(withProviders, "de", "b")).toBe("/global");
    expect(refundLinkFor(withProviders, "de")).toBe("/global");
    expect(legalLinksFor(withProviders, "a")["de"].refund).toBe("/a-refund");
    expect(legalLinksFor(withProviders, "b")["de"].refund).toBe("/global");

    const noGlobal = options({
      documentsAcknowledgement: true,
      providerTexts: { a: { refundLink: "/a-refund" }, b: {} },
    });
    expect(refundLinkFor(noGlobal, "de", "b")).toBeUndefined();
    expect(legalLinksFor(noGlobal, "b")["de"].refund).toBeUndefined();
    expect(documentsAcknowledgementTextFor(noGlobal, "de", "a")).toContain("Erstattungsrichtlinie");
    expect(documentsAcknowledgementTextFor(noGlobal, "de", "b")).not.toContain(
      "Erstattungsrichtlinie",
    );
  });

  test("every locale carries all four texts", () => {
    for (const texts of Object.values(CONSENT_TEXTS)) {
      for (const text of Object.values(texts)) expect(text.length).toBeGreaterThan(20);
    }
  });

  test("locale resolution: exact, language part, fallback en", () => {
    expect(resolveConsentLocale("en")).toBe("en");
    expect(resolveConsentLocale("EN-gb")).toBe("en");
    expect(resolveConsentLocale("de-AT")).toBe("de");
    expect(resolveConsentLocale("fr")).toBe("en");
    expect(resolveConsentLocale("es")).toBe("en");
    expect(resolveConsentLocale(undefined)).toBe("en");
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

  test("legalLinks per locale needs de and en, each link validated", () => {
    const set = { terms: "/t", withdrawal: "/w", privacy: "/p" };
    expect(create(options({ legalLinks: { de: set, en: set } }), base)).not.toThrow();
    const incomplete = { de: set } as unknown as ConsumerProtectionOptions["legalLinks"];
    expect(create(options({ legalLinks: incomplete }), base)).toThrow(/"en" entry/);
    expect(
      create(
        options({ legalLinks: { de: set, en: { ...set, privacy: "http://x.example" } } }),
        base,
      ),
    ).toThrow(/legalLinks\.en\.privacy/);
  });

  test("refund link is optional and validated like the others", () => {
    const set = { terms: "/t", withdrawal: "/w", privacy: "/p" };
    expect(create(options({ legalLinks: { ...set, refund: "/r" } }), base)).not.toThrow();
    expect(create(options({ legalLinks: { ...set, refund: "http://x.example" } }), base)).toThrow(
      /legalLinks\.refund/,
    );
    expect(
      create(options({ legalLinks: { de: set, en: { ...set, refund: "//evil.example" } } }), base),
    ).toThrow(/legalLinks\.en\.refund/);
  });

  test("providerTexts refundLink is validated like the other links", () => {
    const refundOf = (refundLink: unknown) =>
      options({
        providerTexts: {
          a: {
            refundLink: refundLink as NonNullable<
              ConsumerProtectionOptions["providerTexts"]
            >[string]["refundLink"],
          },
        },
      });
    expect(create(refundOf("/r"), base)).not.toThrow();
    expect(create(refundOf({ de: "/r", en: "https://x.example/r" }), base)).not.toThrow();
    expect(create(refundOf("http://x.example"), base)).toThrow(/providerTexts\.a\.refundLink/);
    expect(create(refundOf({ de: "/r", en: "//evil.example" }), base)).toThrow(
      /providerTexts\.a\.refundLink\.en/,
    );
    expect(create(refundOf({ de: "/r" }), base)).toThrow(/providerTexts\.a\.refundLink\.en/);
  });
});
