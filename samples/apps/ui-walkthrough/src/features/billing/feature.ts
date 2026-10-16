import { defineFeature, templateVariable } from "@cosmicdrift/kumiko-framework/engine";
import { toKeyFirst } from "../translations";
import { billingTranslations } from "./i18n";

// Both mails are sent by the host app's billing run, not by an event trigger in
// this sample; they exist so the template overview has real senders to show.
const INVOICE_ISSUED_VARIABLES = {
  recipientName: templateVariable.text({
    label: "Empfängername",
    required: true,
    example: "Familie Yilmaz",
  }),
  invoiceNumber: templateVariable.text({
    label: "Rechnungsnummer",
    required: true,
    example: "RE-2026-0142",
  }),
  invoiceTotal: templateVariable.money({
    label: "Rechnungsbetrag",
    required: true,
    example: { amount: 128450, currency: "EUR" },
  }),
  dueDate: templateVariable.date({
    label: "Fälligkeitsdatum",
    required: true,
    example: "2026-10-30",
  }),
  invoiceUrl: templateVariable.link({
    label: "Link zur Rechnung",
    required: true,
    example: "https://nordlicht-immobilien.de/rechnungen/RE-2026-0142",
  }),
  lines: templateVariable.list(
    {
      description: templateVariable.text({ label: "Bezeichnung" }),
      amount: templateVariable.money({ label: "Betrag" }),
    },
    {
      label: "Rechnungspositionen",
      required: true,
      example: [
        { description: "Kaltmiete Oktober 2026, Lindenstraße 14 WE 3", amount: 98000 },
        { description: "Betriebskostenvorauszahlung Oktober 2026", amount: 24500 },
        { description: "Stellplatz 7, Oktober 2026", amount: 5950 },
      ],
    },
  ),
  paymentReference: templateVariable.text({
    label: "Zahlungsreferenz",
    example: "RE-2026-0142 / Yilmaz",
  }),
} as const;

const PAYMENT_REMINDER_VARIABLES = {
  customerName: templateVariable.text({ required: true }),
  invoiceNumber: templateVariable.text({ required: true }),
  amount: templateVariable.money({ required: true }),
  dueDate: templateVariable.date({ required: true }),
  invoiceUrl: templateVariable.link({ required: true }),
} as const;

export const billingFeature = defineFeature("billing", (r) => {
  r.translations({ keys: toKeyFirst(billingTranslations) });

  r.notification("invoice-issued", { variables: INVOICE_ISSUED_VARIABLES });
  r.notification("invoice-corrected", { variables: INVOICE_ISSUED_VARIABLES });
  r.notification("payment-reminder", { variables: PAYMENT_REMINDER_VARIABLES });
});
