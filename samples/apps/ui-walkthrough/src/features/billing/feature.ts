import { defineFeature, templateVariable } from "@cosmicdrift/kumiko-framework/engine";
import { toKeyFirst } from "../translations";
import { billingTranslations } from "./i18n";

// Variable labels are i18n keys, so the designer's rail and chips speak the editor's language.
// Both mails are sent by the host app's billing run, not by an event trigger in
// this sample; they exist so the template overview has real senders to show.
const INVOICE_ISSUED_VARIABLES = {
  recipientName: templateVariable.text({
    label: "billing:mail.variable.recipientName",
    required: true,
    example: "Familie Yilmaz",
  }),
  recipientEmail: templateVariable.text({
    label: "billing:mail.variable.recipientEmail",
    example: "yilmaz.familie@example.org",
  }),
  invoiceNumber: templateVariable.text({
    label: "billing:mail.variable.invoiceNumber",
    required: true,
    example: "RE-2026-0142",
  }),
  invoiceTotal: templateVariable.money({
    label: "billing:mail.variable.invoiceTotal",
    required: true,
    example: { amount: 128450, currency: "EUR" },
  }),
  dueDate: templateVariable.date({
    label: "billing:mail.variable.dueDate",
    required: true,
    example: "2026-10-30",
  }),
  invoiceUrl: templateVariable.link({
    label: "billing:mail.variable.invoiceUrl",
    required: true,
    example: "https://nordlicht-immobilien.de/rechnungen/RE-2026-0142",
  }),
  lines: templateVariable.list(
    {
      description: templateVariable.text({ label: "billing:mail.variable.lines.description" }),
      amount: templateVariable.money({ label: "billing:mail.variable.lines.amount" }),
    },
    {
      label: "billing:mail.variable.lines",
      required: true,
      example: [
        { description: "Kaltmiete Oktober 2026, Lindenstraße 14 WE 3", amount: 98000 },
        { description: "Betriebskostenvorauszahlung Oktober 2026", amount: 24500 },
        { description: "Stellplatz 7, Oktober 2026", amount: 5950 },
      ],
    },
  ),
  paymentReference: templateVariable.text({
    label: "billing:mail.variable.paymentReference",
    example: "RE-2026-0142 / Yilmaz",
  }),
  // A text example given as i18n key follows the edited template's language.
  noticeLabel: templateVariable.text({
    label: "billing:mail.variable.noticeLabel",
    example: "billing:mail.example.noticeLabel",
  }),
  noticeTone: templateVariable.text({
    label: "billing:mail.variable.noticeTone",
    example: "success",
  }),
} as const;

const PAYMENT_REMINDER_VARIABLES = {
  customerName: templateVariable.text({ required: true }),
  invoiceNumber: templateVariable.text({ required: true }),
  amount: templateVariable.money({ required: true }),
  dueDate: templateVariable.date({ required: true }),
  invoiceUrl: templateVariable.link({ required: true }),
} as const;

const TERMS_CHANGED_VARIABLES = {
  customerName: templateVariable.text({ required: true, example: "Familie Yilmaz" }),
  effectiveDate: templateVariable.date({ required: true, example: "2026-12-01" }),
} as const;

export const billingFeature = defineFeature("billing", (r) => {
  r.translations({ keys: toKeyFirst(billingTranslations) });

  r.notification("invoice-issued", { variables: INVOICE_ISSUED_VARIABLES });
  r.notification("invoice-corrected", { variables: INVOICE_ISSUED_VARIABLES });
  r.notification("payment-reminder", { variables: PAYMENT_REMINDER_VARIABLES });
  // Legal wording the platform owns: tenant admins neither see nor override it.
  r.notification("terms-changed", { variables: TERMS_CHANGED_VARIABLES, systemOnly: true });
});
