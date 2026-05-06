// TenantCurrency — which currencies each tenant is allowed to use
// References currency.code, adds isActive flag per tenant

import { buildDrizzleTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createBooleanField,
  createEntity,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";

export const tenantCurrencyEntity = createEntity({
  table: "read_sample_tenant_currencies",
  fields: {
    currencyCode: createTextField({ required: true }),
    isActive: createBooleanField({ default: true }),
  },
});

export const tenantCurrencyTable = buildDrizzleTable("tenant-currency", tenantCurrencyEntity);
