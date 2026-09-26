// billing-plans — lists the catalog's purchasable plans with live price,
// benefits, the caller's current tier and per-plan action. Only registered
// when `createBillingFoundationFeature` gets a `catalog`.

import type { QueryHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { resolveCatalogProvider } from "../checkout-core";
import { buildBillingPlans } from "../plan-catalog";
import type { BillingPlanCatalog, BillingPlansResult } from "../types";

const billingPlansSchema = z.object({}).strict();

export function createBillingPlansQuery(catalog: BillingPlanCatalog): QueryHandlerDef {
  return {
    name: "billing-plans",
    description:
      "Lists the purchasable plans with live price, benefits, the caller's current tier and which action (checkout | switch | current | unavailable) each plan offers.",
    schema: billingPlansSchema,
    access: { roles: catalog.viewRoles },
    handler: async (_query, ctx): Promise<BillingPlansResult> => {
      const { plugin } = resolveCatalogProvider(ctx, catalog);
      return buildBillingPlans(ctx, plugin, catalog);
    },
  };
}
