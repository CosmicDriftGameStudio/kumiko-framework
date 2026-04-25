// Money Shared Sample
// Shows: Shared (global) currencies via r.referenceData(), per-tenant assignment
//
// Pattern: Currencies are global master data — tenants pick which ones they use.
// Use this when: All tenants share the same currency catalog (ISO 4217 etc.)
//
// Tables:
//   currency         — global reference data (seeded from CURRENCY_CATALOG below)
//   tenantCurrency   — which currencies each tenant may use (with isActive flag)
//   invoice          — money fields validated against tenantCurrency

import { defineFeature } from "@kumiko/framework/engine";
import { currencyEntity } from "./entities/currency";
import { invoiceEntity } from "./entities/invoice";
import { tenantCurrencyEntity } from "./entities/tenant-currency";
import { invoiceCreate } from "./handlers/invoice-create.write";
import { invoiceDetail } from "./handlers/invoice-detail.query";
import { tenantCurrencyAssign } from "./handlers/tenant-currency-assign.write";

export { currencyEntity } from "./entities/currency";
export { invoiceEntity } from "./entities/invoice";
export { tenantCurrencyEntity } from "./entities/tenant-currency";

// All currencies available in this app — seeded as global reference data
const CURRENCY_CATALOG = [
  // Standard currencies
  { code: "EUR", name: "Euro" },
  { code: "USD", name: "US Dollar" },
  { code: "GBP", name: "British Pound" },
  { code: "CHF", name: "Swiss Franc" },
  { code: "JPY", name: "Japanese Yen" },
  { code: "SEK", name: "Swedish Krona" },
  { code: "NOK", name: "Norwegian Krone" },
  { code: "DKK", name: "Danish Krone" },
  { code: "PLN", name: "Polish Zloty" },
  { code: "CZK", name: "Czech Koruna" },
  { code: "CAD", name: "Canadian Dollar" },
  { code: "AUD", name: "Australian Dollar" },
  { code: "NZD", name: "New Zealand Dollar" },
  { code: "CNY", name: "Chinese Yuan" },
  { code: "INR", name: "Indian Rupee" },
  // Custom currencies added by this app
  { code: "BHD", name: "Bahraini Dinar" },
  { code: "SAR", name: "Saudi Riyal" },
  { code: "TRY", name: "Turkish Lira" },
  { code: "KRW", name: "South Korean Won" },
  { code: "BRL", name: "Brazilian Real" },
  { code: "XYZ", name: "Custom Token" },
] as const;

export const moneyFeature = defineFeature("money", (r) => {
  const currency = r.entity("currency", currencyEntity);
  r.entity("tenant-currency", tenantCurrencyEntity);
  r.entity("invoice", invoiceEntity);

  // Seed global currency table — available for all tenants to pick from
  r.referenceData(currency, [...CURRENCY_CATALOG], { upsertKey: "code" });

  r.writeHandler(tenantCurrencyAssign);
  r.writeHandler(invoiceCreate);
  r.queryHandler(invoiceDetail);
});
