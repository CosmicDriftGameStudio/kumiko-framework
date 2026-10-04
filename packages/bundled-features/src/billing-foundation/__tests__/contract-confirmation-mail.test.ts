import { describe, expect, test } from "bun:test";
import { simpleRenderer } from "../../renderer-simple/index.js";
import {
  type ContractConfirmationSection,
  type RenderContractConfirmationArgs,
  renderContractConfirmation,
} from "../consumer-protection/confirmation-mail.js";
import { CONSENT_TEXTS } from "../consumer-protection/consent-text.js";
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

function render(
  locale: string,
  termsContent = "Terms line one.\n\nTerms line two.",
  extra: Partial<RenderContractConfirmationArgs> = {},
) {
  return renderContractConfirmation({
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

function sectionText(section: ContractConfirmationSection): string {
  if ("text" in section) return section.text;
  if ("heading" in section) return section.heading;
  return section.markdown;
}

function allText(
  locale: string,
  termsContent?: string,
  extra?: Partial<RenderContractConfirmationArgs>,
): string {
  const content = render(locale, termsContent, extra);
  return [
    content.subject,
    content.header,
    ...content.sections.map(sectionText),
    content.footer,
  ].join("\n");
}

describe("renderContractConfirmation", () => {
  test("de carries plan, price, dates, VAT note, consent texts and the full terms", () => {
    const text = allText("de");
    expect(text).toContain("Vertragsbestätigung");
    expect(text).toContain("Tarif: pro");
    expect(text).toContain("19,00");
    expect(text).toContain("Monat");
    expect(text).toContain("Preise inkl. USt.");
    expect(text).toContain(CONSENT_TEXTS.de.earlyPerformance);
    expect(text).toContain(CONSENT_TEXTS.de.withdrawalLoss);
    expect(text).toContain("Terms line one.");
    expect(text).toContain("Terms line two.");
    expect(text).toContain("Aktueller Abrechnungszeitraum bis");
    expect(text).toContain("billing@example.com");
  });

  test("en renders English labels and consent texts", () => {
    const text = allText("en");
    expect(text).toContain("Contract confirmation");
    expect(text).toContain("Plan: pro");
    expect(text).toContain("Prices include VAT.");
    expect(text).toContain(CONSENT_TEXTS.en.earlyPerformance);
  });

  test("an unknown locale falls back to English", () => {
    const text = allText("fr");
    expect(text).toContain("Contract confirmation");
    expect(text).toContain(CONSENT_TEXTS.en.earlyPerformance);
  });

  test("dates carry the zone name and are shown in the given zone", () => {
    const berlin = allText("en", undefined, { timeZone: "Europe/Berlin" });
    expect(berlin).toContain("2:30 PM");
    expect(berlin).toMatch(/GMT\+2|CEST/);
    const utc = allText("en");
    expect(utc).toContain("12:30 PM");
    expect(utc).toContain("UTC");
  });

  test("uses the translated tier label, else the raw tier", () => {
    expect(allText("en", undefined, { tierLabel: "Pro plan" })).toContain("Plan: Pro plan");
    expect(allText("en")).toContain("Plan: pro");
  });

  test("a one-off payment shows the item label, else the generic text", () => {
    const payment = { ...consentFor("en"), mode: "payment" as const, tier: null, interval: null };
    expect(allText("en", undefined, { consent: payment, itemLabel: "500 credits" })).toContain(
      "Item: 500 credits",
    );
    expect(allText("en", undefined, { consent: payment })).toContain("Item: One-off payment");
    expect(allText("de", undefined, { consent: { ...payment, locale: "de" } })).toContain(
      "Leistung: Einmalzahlung",
    );
  });

  test("terms and consent headings are heading sections, terms one markdown section", () => {
    const { sections } = render("en", "# AGB\n\nText");
    expect(sections).toContainEqual({ heading: "Your consents" });
    expect(sections).toContainEqual({ heading: "Terms and conditions" });
    expect(sections).toContainEqual({ markdown: "# AGB\n\nText" });
  });

  test("omits the period end when the trigger did not carry one", () => {
    const content = renderContractConfirmation({
      consent: consentFor("en"),
      timeZone: "UTC",
      consentGivenAtIso: "2026-10-01T10:00:00Z",
      contractStartIso: "2026-10-02T12:30:00Z",
      vatNote,
      operatorEmail: "billing@example.com",
      termsContent: "Terms.",
    });
    expect(content.sections.map(sectionText).join("\n")).not.toContain("billing period ends");
  });

  test("a terms text with markup is HTML-escaped by the renderer", async () => {
    const content = render("de", "Before <script>alert(1)</script> after");
    const html = await simpleRenderer.render({
      template: "billing-foundation:contract-confirmation",
      variables: content,
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
