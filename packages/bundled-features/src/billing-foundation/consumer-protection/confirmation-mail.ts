import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { Marked } from "marked";
import type { CheckoutConsentRecordedPayload } from "../events.js";
import { type ConsentLocale, resolveConsentLocale } from "./consent-text.js";

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

export const CONFIRMATION_LABELS: Readonly<Record<ConsentLocale, ConfirmationLabels>> = {
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

type TextRow = { readonly text: string };

/** Variables of the contract confirmation template. */
export type ContractConfirmationVariables = {
  readonly contractLines: readonly TextRow[];
  readonly consentGivenAt: string;
  readonly termsParagraphs: readonly TextRow[];
  readonly operatorEmail: string;
};

export type ContractConfirmationArgs = {
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
  const labels = CONFIRMATION_LABELS[locale];
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

// The mail template only knows plain text variables, so the Markdown terms are
// rendered to plain text: emphasis and code lose their markers, links become
// "label (url)", and each block (paragraph, heading, list item) is one row.
const ROW_END = "\n\n";
const plainTextMarkdown = new Marked({ gfm: false, breaks: false });
plainTextMarkdown.use({
  renderer: {
    heading({ tokens }) {
      return `${this.parser.parseInline(tokens)}${ROW_END}`;
    },
    paragraph({ tokens }) {
      return `${this.parser.parseInline(tokens)}${ROW_END}`;
    },
    code: ({ text }) => `${text}${ROW_END}`,
    blockquote({ tokens }) {
      return this.parser.parse(tokens);
    },
    list({ items }) {
      return items.map((item) => this.parser.parse(item.tokens)).join("");
    },
    hr: () => "",
    space: () => "",
    strong({ tokens }) {
      return this.parser.parseInline(tokens);
    },
    em({ tokens }) {
      return this.parser.parseInline(tokens);
    },
    del({ tokens }) {
      return this.parser.parseInline(tokens);
    },
    codespan: ({ text }) => text,
    br: () => " ",
    html: ({ text }) => text,
    image: ({ text }) => text,
    text(token) {
      // Only block-level text (a list item's own text) carries inline child tokens.
      return "tokens" in token && token.tokens
        ? `${this.parser.parseInline(token.tokens)}${ROW_END}`
        : token.text;
    },
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      return label === href ? href : `${label} (${href})`;
    },
  },
});

function termsParagraphsOf(markdown: string): readonly TextRow[] {
  return plainTextMarkdown
    .parse(markdown, { async: false })
    .split(/\n\s*\n/)
    .map((row) => row.replace(/\s+/g, " ").trim())
    .filter((row) => row.length > 0)
    .map((text) => ({ text }));
}

export function contractConfirmationVariables(
  args: ContractConfirmationArgs,
): ContractConfirmationVariables {
  const locale = resolveConsentLocale(args.consent.locale);
  const labels = CONFIRMATION_LABELS[locale];
  const { consent, timeZone } = args;

  const subjectLine =
    consent.mode === "payment"
      ? `${labels.item}: ${args.itemLabel ?? labels.oneOffPayment}`
      : `${labels.plan}: ${args.tierLabel ?? consent.tier ?? labels.oneOffPayment}`;
  const vatNote = args.vatNote[locale] ?? args.vatNote[resolveConsentLocale()];

  return {
    contractLines: [
      subjectLine,
      `${labels.price}: ${formatPrice(consent, locale)}`,
      `${labels.contractStart}: ${formatDate(args.contractStartIso, locale, timeZone)}`,
      ...(args.currentPeriodEndIso !== undefined
        ? [`${labels.currentPeriodEnd}: ${formatDate(args.currentPeriodEndIso, locale, timeZone)}`]
        : []),
      ...(vatNote !== undefined ? [vatNote] : []),
    ].map((text) => ({ text })),
    consentGivenAt: formatDate(args.consentGivenAtIso, locale, timeZone),
    termsParagraphs: termsParagraphsOf(args.termsContent),
    operatorEmail: args.operatorEmail,
  };
}
