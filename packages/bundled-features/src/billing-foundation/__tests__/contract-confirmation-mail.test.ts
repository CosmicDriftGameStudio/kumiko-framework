import { describe, expect, test } from "bun:test";
import {
  type ContractConfirmationArgs,
  contractConfirmationVariables,
} from "../consumer-protection/confirmation-mail.js";
import { CONSENT_TEXTS } from "../consumer-protection/consent-text.js";
import { contractConfirmationTemplate } from "../consumer-protection/mail-notifications.js";
import type { CheckoutConsentRecordedPayload } from "../events.js";

const vatNote = { de: "Preise inkl. USt.", en: "Prices include VAT." };

function consentFor(locale: string): CheckoutConsentRecordedPayload {
  return {
    consentId: "consent-1",
    mode: "subscription",
    tier: "pro",
    priceId: "price_pro",
    unitAmount: 1900,
    currency: "eur",
    interval: "month",
    intervalCount: 1,
    consentTextVersion: "v1",
    termsHash: "a".repeat(64),
    termsTemplateVersion: 1,
    locale,
    actorUserId: "user-1",
  };
}

function variablesFor(
  locale: string,
  termsContent = "Terms line one.\n\nTerms line two.",
  extra: Partial<ContractConfirmationArgs> = {},
) {
  return contractConfirmationVariables({
    consent: consentFor(locale),
    timeZone: "UTC",
    consentGivenAtIso: "2026-10-01T10:00:00Z",
    contractStartIso: "2026-10-02T12:30:00Z",
    currentPeriodEndIso: "2026-11-02T12:30:00Z",
    vatNote,
    operatorEmail: "billing@example.com",
    termsContent,
    ...extra,
  });
}

function contractText(
  locale: string,
  termsContent?: string,
  extra?: Partial<ContractConfirmationArgs>,
): string {
  const variables = variablesFor(locale, termsContent, extra);
  return [...variables.contractLines.map((row) => row.text), variables.consentGivenAt].join("\n");
}

describe("contractConfirmationVariables", () => {
  test("de carries plan, price, dates and VAT note as rows, the terms as paragraphs", () => {
    const variables = variablesFor("de");
    const text = contractText("de");
    expect(text).toContain("Tarif: pro");
    expect(text).toContain("19,00");
    expect(text).toContain("Monat");
    expect(text).toContain("Preise inkl. USt.");
    expect(text).toContain("Aktueller Abrechnungszeitraum bis");
    expect(variables.termsParagraphs).toEqual([
      { text: "Terms line one." },
      { text: "Terms line two." },
    ]);
    expect(variables.operatorEmail).toBe("billing@example.com");
  });

  test("en renders English labels", () => {
    const text = contractText("en");
    expect(text).toContain("Plan: pro");
    expect(text).toContain("Prices include VAT.");
  });

  test("an unknown locale falls back to English", () => {
    expect(contractText("fr")).toContain("Plan: pro");
  });

  test("dates carry the zone name and are shown in the given zone", () => {
    const berlin = contractText("en", undefined, { timeZone: "Europe/Berlin" });
    expect(berlin).toContain("2:30 PM");
    expect(berlin).toMatch(/GMT\+2|CEST/);
    const utc = contractText("en");
    expect(utc).toContain("12:30 PM");
    expect(utc).toContain("UTC");
  });

  test("uses the translated tier label, else the raw tier", () => {
    expect(contractText("en", undefined, { tierLabel: "Pro plan" })).toContain("Plan: Pro plan");
    expect(contractText("en")).toContain("Plan: pro");
  });

  test("a one-off payment shows the item label, else the generic text", () => {
    const payment = { ...consentFor("en"), mode: "payment" as const, tier: null, interval: null };
    expect(contractText("en", undefined, { consent: payment, itemLabel: "500 credits" })).toContain(
      "Item: 500 credits",
    );
    expect(contractText("en", undefined, { consent: payment })).toContain("Item: One-off payment");
    expect(contractText("de", undefined, { consent: { ...payment, locale: "de" } })).toContain(
      "Leistung: Einmalzahlung",
    );
  });

  test("terms heading markers are dropped and blank-line paragraphs become rows", () => {
    expect(variablesFor("en", "# AGB\n\nText").termsParagraphs).toEqual([
      { text: "AGB" },
      { text: "Text" },
    ]);
  });

  test("omits the period end when the trigger did not carry one", () => {
    const variables = contractConfirmationVariables({
      consent: consentFor("en"),
      timeZone: "UTC",
      consentGivenAtIso: "2026-10-01T10:00:00Z",
      contractStartIso: "2026-10-02T12:30:00Z",
      vatNote,
      operatorEmail: "billing@example.com",
      termsContent: "Terms.",
    });
    expect(variables.contractLines.map((row) => row.text).join("\n")).not.toContain(
      "billing period ends",
    );
  });
});

describe("contractConfirmationTemplate", () => {
  test("ships de and en with the legal consent wording and the subject of the locale", () => {
    const template = contractConfirmationTemplate();
    expect(Object.keys(template).sort()).toEqual(["de", "en"]);
    expect(template["de"]?.meta.subject).toBe("Vertragsbestätigung");
    expect(template["en"]?.meta.subject).toBe("Contract confirmation");
    expect(template["de"]?.body).toContain(CONSENT_TEXTS.de.earlyPerformance);
    expect(template["en"]?.body).toContain(CONSENT_TEXTS.en.withdrawalLoss);
  });
});
