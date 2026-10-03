import { createHash } from "node:crypto";
import type { ConsentLocale } from "./consent-locale.js";

export {
  CONSENT_LOCALES,
  type ConsentLocale,
  FALLBACK_CONSENT_LOCALE,
  resolveConsentLocale,
} from "./consent-locale.js";

// Legal texts, deliberately inline de/en: the wording is part of the recorded
// consent, so it cannot follow the en-only i18n convention.
export type ConsentTexts = {
  readonly earlyPerformance: string;
  readonly withdrawalLoss: string;
  readonly subscriptionSubmitMessage: string;
  readonly paymentSubmitMessage: string;
};

export const CONSENT_TEXTS: Readonly<Record<ConsentLocale, ConsentTexts>> = {
  de: {
    earlyPerformance:
      "Ich verlange ausdrücklich, dass der Anbieter vor Ablauf der Widerrufsfrist mit der Ausführung des Vertrags beginnt.",
    withdrawalLoss:
      "Ich nehme zur Kenntnis, dass ich mein Widerrufsrecht verliere, sobald der Vertrag von dem Anbieter vollständig erfüllt ist, bei digitalen Inhalten sobald die Ausführung begonnen hat, nachdem ich ausdrücklich zugestimmt habe und bestätigt habe, dass ich dadurch mein Widerrufsrecht verliere.",
    subscriptionSubmitMessage:
      "Kostenpflichtiges Abonnement: Es verlängert sich zum Ende jedes Abrechnungszeitraums automatisch, bis Sie es kündigen. Sie können jederzeit zum Ende des laufenden Zeitraums kündigen.",
    paymentSubmitMessage:
      "Kostenpflichtige Einmalzahlung: Mit Klick auf den Button verpflichten Sie sich zur Zahlung.",
  },
  en: {
    earlyPerformance:
      "I expressly request that the provider begins performing the contract before the withdrawal period has expired.",
    withdrawalLoss:
      "I acknowledge that I lose my right of withdrawal once the provider has fully performed the contract, and for digital content once performance has begun, after I have expressly consented and confirmed that I lose my right of withdrawal as a result.",
    subscriptionSubmitMessage:
      "Paid subscription: it renews automatically at the end of each billing period until you cancel. You can cancel at any time, effective at the end of the current period.",
    paymentSubmitMessage: "Paid one-off payment: by clicking the button you commit to paying.",
  },
};

const CONSENT_TEXT_VERSION_LENGTH = 16;

export function consentTextVersion(locale: ConsentLocale): string {
  const { earlyPerformance, withdrawalLoss } = CONSENT_TEXTS[locale];
  return createHash("sha256")
    .update(`${earlyPerformance}\n${withdrawalLoss}`)
    .digest("hex")
    .slice(0, CONSENT_TEXT_VERSION_LENGTH);
}

export function submitMessageFor(locale: ConsentLocale, mode: "subscription" | "payment"): string {
  const texts = CONSENT_TEXTS[locale];
  return mode === "subscription" ? texts.subscriptionSubmitMessage : texts.paymentSubmitMessage;
}
