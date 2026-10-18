import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";

// The keys follow the document-designer's "used by" lookup:
// `<feature>:feature.label` and `<feature>:notify.<notification>.label`. Variable labels
// are plain keys the notification's variables name in their `label`.
export const billingTranslations: TranslationsByLocale = {
  de: {
    "billing:feature.label": "Rechnungen",
    "billing:notify.invoice-issued.label": "Rechnung gestellt",
    "billing:notify.invoice-corrected.label": "Rechnung korrigiert",
    "billing:notify.payment-reminder.label": "Mahnlauf",
    "billing:notify.terms-changed.label": "AGB-Änderung",
    "billing:mail.variable.recipientName": "Empfängername",
    "billing:mail.variable.recipientEmail": "Empfänger-Adresse",
    "billing:mail.variable.invoiceNumber": "Rechnungsnummer",
    "billing:mail.variable.invoiceTotal": "Rechnungsbetrag",
    "billing:mail.variable.dueDate": "Fälligkeitsdatum",
    "billing:mail.variable.invoiceUrl": "Link zur Rechnung",
    "billing:mail.variable.lines.description": "Bezeichnung",
    "billing:mail.variable.lines.amount": "Betrag",
    "billing:mail.variable.lines": "Rechnungspositionen",
    "billing:mail.variable.paymentReference": "Zahlungsreferenz",
  },
  en: {
    "billing:feature.label": "Invoices",
    "billing:notify.invoice-issued.label": "Invoice issued",
    "billing:notify.invoice-corrected.label": "Invoice corrected",
    "billing:notify.payment-reminder.label": "Dunning run",
    "billing:notify.terms-changed.label": "Terms update",
    "billing:mail.variable.recipientName": "Recipient name",
    "billing:mail.variable.recipientEmail": "Recipient address",
    "billing:mail.variable.invoiceNumber": "Invoice number",
    "billing:mail.variable.invoiceTotal": "Invoice total",
    "billing:mail.variable.dueDate": "Due date",
    "billing:mail.variable.invoiceUrl": "Invoice link",
    "billing:mail.variable.lines.description": "Description",
    "billing:mail.variable.lines.amount": "Amount",
    "billing:mail.variable.lines": "Invoice lines",
    "billing:mail.variable.paymentReference": "Payment reference",
  },
};
