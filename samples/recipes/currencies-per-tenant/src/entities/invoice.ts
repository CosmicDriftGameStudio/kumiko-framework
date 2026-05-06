import { buildDrizzleTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createMoneyField,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";

export const invoiceEntity = createEntity({
  table: "read_sample_mt_invoices",
  fields: {
    title: createTextField({ required: true }),
    amount: createMoneyField({ required: true }),
    shippingCost: createMoneyField(),
  },
  defaultCurrency: "EUR",
});

export const invoiceTable = buildDrizzleTable("invoice", invoiceEntity);
