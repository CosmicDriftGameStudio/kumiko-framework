// TenantCurrency — which currencies each tenant is allowed to use
// References currency.code, adds isActive flag per tenant

import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createBooleanField,
  createEntity,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";

export const tenantCurrencyEntity = createEntity({
  table: "read_sample_tenant_currencies",
  fields: {
    currencyCode: createTextField({ personal: false, reason: "is_reference_data", required: true }),
    isActive: createBooleanField({ default: true }),
  },
});

export const tenantCurrencyTable = buildEntityTable("tenant-currency", tenantCurrencyEntity);
