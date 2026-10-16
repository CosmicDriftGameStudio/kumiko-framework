import { defineFeature, templateVariable } from "@cosmicdrift/kumiko-framework/engine";
import { toKeyFirst } from "../translations";
import { billingTranslations } from "./i18n";

// Both mails are sent by the host app's billing run, not by an event trigger in
// this sample; they exist so the template overview has real senders to show.
const INVOICE_VARIABLES = {
  customerName: templateVariable.text({ required: true }),
  invoiceNumber: templateVariable.text({ required: true }),
  amount: templateVariable.money({ required: true }),
  dueDate: templateVariable.date({ required: true }),
  invoiceUrl: templateVariable.link({ required: true }),
} as const;

export const billingFeature = defineFeature("billing", (r) => {
  r.translations({ keys: toKeyFirst(billingTranslations) });

  r.notification("invoice-issued", { variables: INVOICE_VARIABLES });
  r.notification("payment-reminder", { variables: INVOICE_VARIABLES });
});
