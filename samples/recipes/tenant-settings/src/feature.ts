// Consuming tenant-settings: an `invoice` entity whose `amount` (money) and
// `language` (locale) are auto-filled from the tenant's currency/locale
// setting when the caller omits them — instead of hard-coding "EUR"/"en" on
// the field, the mistake this recipe exists to prevent (solon#P19).

import {
  createEntity,
  createMoneyField,
  createSelectField,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { defineCreateWithTenantDefaults } from "@cosmicdrift/kumiko-bundled-features/tenant-settings";

export const invoiceEntity = createEntity({
  table: "read_invoices",
  fields: {
    title: createTextField({ required: true }),
    amount: createMoneyField({ required: true }),
    language: createSelectField({ options: ["en", "de", "fr"] as const }),
  },
});

const ACCESS = { roles: ["Admin"] } as const;

export const invoiceFeature = defineFeature("invoice", (r) => {
  r.entity("invoice", invoiceEntity);
  r.writeHandler(
    defineCreateWithTenantDefaults("invoice", invoiceEntity, {
      access: ACCESS,
      currencyFields: ["amount"],
      localeField: "language",
    }),
  );
});
