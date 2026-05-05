// Money Tenant Sample
// Shows: Tenant-owned currencies — each tenant manages their own currency list
//
// Pattern: No global currency catalog. Each tenant creates currencies themselves.
// Use this when: Tenants need custom currencies (loyalty points, crypto, internal units)
//
// Tables:
//   currency   — tenant-owned, created by tenant admin (with isActive flag)
//   invoice    — money fields validated against tenant's currency table

import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { currencyEntity } from "./entities/currency";
import { invoiceEntity } from "./entities/invoice";
import { currencyCreate } from "./handlers/currency-create.write";
import { invoiceCreate } from "./handlers/invoice-create.write";
import { invoiceDetail } from "./handlers/invoice-detail.query";

export { currencyEntity } from "./entities/currency";
export { invoiceEntity } from "./entities/invoice";

export const currenciesPerTenantFeature = defineFeature("currenciesPerTenant", (r) => {
  r.entity("currency", currencyEntity);
  r.entity("invoice", invoiceEntity);

  // No r.referenceData() — tenants create currencies themselves
  r.writeHandler(currencyCreate);
  r.writeHandler(invoiceCreate);
  r.queryHandler(invoiceDetail);
});
