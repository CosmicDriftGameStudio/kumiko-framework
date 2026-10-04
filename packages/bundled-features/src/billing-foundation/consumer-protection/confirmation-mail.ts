import { Temporal } from "temporal-polyfill";
import type { CheckoutConsentRecordedPayload } from "../events.js";
import { CONSENT_TEXTS, type ConsentLocale, resolveConsentLocale } from "./consent-text.js";

// Inline de/en like the consent texts: the confirmation repeats the legal
// wording the buyer agreed to, so it cannot follow the en-only i18n convention.
type ConfirmationLabels = {
  readonly subject: string;
  readonly intro: string;
  readonly plan: string;
  readonly item: string;
  readonly oneOffPayment: string;
  readonly price: string;
  readonly oneOff: string;
  readonly contractStart: string;
  readonly currentPeriodEnd: string;
  readonly consentHeading: string;
  readonly consentGivenAt: string;
  readonly termsHeading: string;
  readonly contact: string;
  readonly intervals: Readonly<Record<string, { one: string; many: string }>>;
  readonly every: string;
};

const LABELS: Readonly<Record<ConsentLocale, ConfirmationLabels>> = {
  de: {
    subject: "Vertragsbestätigung",
    intro:
      "Vielen Dank für deine Bestellung. Hiermit bestätigen wir den Vertragsschluss mit folgendem Inhalt.",
    plan: "Tarif",
    item: "Leistung",
    oneOffPayment: "Einmalzahlung",
    price: "Preis",
    oneOff: "einmalig",
    contractStart: "Vertragsbeginn",
    currentPeriodEnd: "Aktueller Abrechnungszeitraum bis",
    consentHeading: "Deine Zustimmungen",
    consentGivenAt: "Erteilt am",
    termsHeading: "Allgemeine Geschäftsbedingungen",
    contact: "Fragen zu deinem Vertrag richtest du bitte an",
    every: "alle",
    intervals: {
      day: { one: "Tag", many: "Tage" },
      week: { one: "Woche", many: "Wochen" },
      month: { one: "Monat", many: "Monate" },
      year: { one: "Jahr", many: "Jahre" },
    },
  },
  en: {
    subject: "Contract confirmation",
    intro:
      "Thank you for your order. We hereby confirm the conclusion of the contract with the following content.",
    plan: "Plan",
    item: "Item",
    oneOffPayment: "One-off payment",
    price: "Price",
    oneOff: "one-off",
    contractStart: "Contract start",
    currentPeriodEnd: "Current billing period ends",
    consentHeading: "Your consents",
    consentGivenAt: "Given on",
    termsHeading: "Terms and conditions",
    contact: "Questions about your contract go to",
    every: "every",
    intervals: {
      day: { one: "day", many: "days" },
      week: { one: "week", many: "weeks" },
      month: { one: "month", many: "months" },
      year: { one: "year", many: "years" },
    },
  },
};

export type ContractConfirmationSection =
  | { readonly text: string }
  | { readonly heading: string }
  | { readonly markdown: string };

export type ContractConfirmationContent = {
  readonly subject: string;
  readonly header: string;
  readonly sections: readonly ContractConfirmationSection[];
  readonly footer: string;
};

export type RenderContractConfirmationArgs = {
  readonly consent: CheckoutConsentRecordedPayload;
  readonly timeZone: string;
  /** Translated plan name; falls back to the raw tier. */
  readonly tierLabel?: string;
  /** Translated purchased item for one-off payments; falls back to the generic label. */
  readonly itemLabel?: string;
  readonly consentGivenAtIso: string;
  readonly contractStartIso: string;
  readonly currentPeriodEndIso?: string;
  readonly vatNote: Readonly<Record<string, string>>;
  readonly operatorEmail: string;
  readonly termsContent: string;
};

function formatPrice(consent: CheckoutConsentRecordedPayload, locale: ConsentLocale): string {
  const labels = LABELS[locale];
  if (consent.unitAmount === null || consent.currency === null) return "-";
  let amount: string;
  try {
    const format = new Intl.NumberFormat(locale, { style: "currency", currency: consent.currency });
    const fractionDigits = format.resolvedOptions().maximumFractionDigits ?? 2;
    amount = format.format(consent.unitAmount / 10 ** fractionDigits);
  } catch {
    // Currency codes come from the provider; an unknown one must not block the mail.
    amount = `${consent.unitAmount} ${consent.currency.toUpperCase()}`;
  }
  if (consent.interval === null) return `${amount} (${labels.oneOff})`;
  const unit = labels.intervals[consent.interval];
  const count = consent.intervalCount ?? 1;
  const intervalText =
    unit === undefined
      ? consent.interval
      : count === 1
        ? unit.one
        : `${labels.every} ${count} ${unit.many}`;
  return count === 1 ? `${amount} / ${intervalText}` : `${amount}, ${intervalText}`;
}

function formatDate(iso: string, locale: ConsentLocale, timeZone: string): string {
  let epochMilliseconds: number;
  try {
    epochMilliseconds = Temporal.Instant.from(iso).epochMilliseconds;
  } catch {
    return iso;
  }
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(epochMilliseconds);
}

/** Structured mail content (header/sections/footer) for the email channel's
 *  renderer; the renderer owns HTML escaping, this only builds plain text. */
export function renderContractConfirmation(
  args: RenderContractConfirmationArgs,
): ContractConfirmationContent {
  const locale = resolveConsentLocale(args.consent.locale);
  const labels = LABELS[locale];
  const texts = CONSENT_TEXTS[locale];
  const { consent } = args;

  const { timeZone } = args;
  const subjectLine =
    consent.mode === "payment"
      ? `${labels.item}: ${args.itemLabel ?? labels.oneOffPayment}`
      : `${labels.plan}: ${args.tierLabel ?? consent.tier ?? labels.oneOffPayment}`;
  const contractLines = [
    subjectLine,
    `${labels.price}: ${formatPrice(consent, locale)}`,
    `${labels.contractStart}: ${formatDate(args.contractStartIso, locale, timeZone)}`,
    ...(args.currentPeriodEndIso !== undefined
      ? [`${labels.currentPeriodEnd}: ${formatDate(args.currentPeriodEndIso, locale, timeZone)}`]
      : []),
  ];
  const vatNote = args.vatNote[locale] ?? args.vatNote[resolveConsentLocale()];

  return {
    subject: labels.subject,
    header: labels.subject,
    sections: [
      { text: labels.intro },
      ...contractLines.map((text) => ({ text })),
      ...(vatNote !== undefined ? [{ text: vatNote }] : []),
      { heading: labels.consentHeading },
      { text: texts.earlyPerformance },
      { text: texts.withdrawalLoss },
      { text: `${labels.consentGivenAt}: ${formatDate(args.consentGivenAtIso, locale, timeZone)}` },
      { heading: labels.termsHeading },
      { markdown: args.termsContent },
    ],
    footer: `${labels.contact} ${args.operatorEmail}`,
  };
}
