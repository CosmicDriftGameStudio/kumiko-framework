import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createMoneyField,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";

export const invoiceEntity = createEntity({
  table: "read_sample_invoices",
  fields: {
    title: createTextField({ personal: false, reason: "is_business_data", required: true }),
    amount: createMoneyField({ required: true }),
    shippingCost: createMoneyField(),
  },
  defaultCurrency: "EUR",
});

export const invoiceTable = buildEntityTable("invoice", invoiceEntity);
