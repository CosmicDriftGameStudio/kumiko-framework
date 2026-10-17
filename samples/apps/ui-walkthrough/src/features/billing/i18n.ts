import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";

// The keys follow the document-designer's "used by" lookup:
// `<feature>:feature.label` and `<feature>:notify.<notification>.label`.
export const billingTranslations: TranslationsByLocale = {
  de: {
    "billing:feature.label": "Rechnungen",
    "billing:notify.invoice-issued.label": "Rechnung gestellt",
    "billing:notify.invoice-corrected.label": "Rechnung korrigiert",
    "billing:notify.payment-reminder.label": "Mahnlauf",
    "billing:notify.terms-changed.label": "AGB-Änderung",
  },
  en: {
    "billing:feature.label": "Invoices",
    "billing:notify.invoice-issued.label": "Invoice issued",
    "billing:notify.invoice-corrected.label": "Invoice corrected",
    "billing:notify.payment-reminder.label": "Dunning run",
    "billing:notify.terms-changed.label": "Terms update",
  },
};
