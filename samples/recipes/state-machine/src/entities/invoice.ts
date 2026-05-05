import {
  createEntity,
  createMoneyField,
  createSelectField,
  createTextField,
  defineTransitions,
} from "@app/define";
import { buildDrizzleTable } from "@cosmicdrift/kumiko-framework/db";

export const INVOICE_STATES = ["draft", "sent", "paid", "cancelled"] as const;

// Single source of truth for transitions — used by entity AND handlers
const TRANSITION_CONFIG = {
  draft: ["sent"],
  sent: ["paid", "cancelled"],
  paid: [],
  cancelled: ["draft"], // reopen: cancelled → draft
} as const;

export const INVOICE_TRANSITIONS = defineTransitions(TRANSITION_CONFIG);

export const invoiceEntity = createEntity({
  table: "read_sample_sm_invoices",
  fields: {
    title: createTextField({ required: true }),
    amount: createMoneyField({ required: true }),
    status: createSelectField({ options: INVOICE_STATES, default: "draft" }),
  },
  defaultCurrency: "EUR",
  transitions: {
    status: TRANSITION_CONFIG,
  },
});

export const invoiceTable = buildDrizzleTable("invoice", invoiceEntity);
