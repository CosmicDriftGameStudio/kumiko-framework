// plan-switch-preview — what switching to a tier would cost right now, for
// providers that switch plans in-app (previewPlanSwitch + applyPlanSwitch).
// Only registered when `createBillingFoundationFeature` gets a `catalog`.

import type { QueryHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { isNonEmptyStringArray } from "../checkout-core.ts";
import { purchaseRolesOf } from "../plan-catalog.ts";
import { preparePlanSwitch } from "../plan-switch.ts";
import type { BillingPlanCatalog, PlanSwitchPreview } from "../types.ts";

export type PlanSwitchPreviewResult = {
  readonly preview: PlanSwitchPreview;
  readonly target: {
    readonly tier: string;
    readonly unitAmount: number;
    readonly currency: string;
    readonly interval: "day" | "week" | "month" | "year" | null;
    readonly intervalCount: number | null;
  };
};

export function createPlanSwitchPreviewQuery(catalog: BillingPlanCatalog): QueryHandlerDef {
  const plans = catalog.plans;
  if (!isNonEmptyStringArray(plans)) {
    throw new Error("plan-switch-preview: catalog.plans must not be empty");
  }
  const schema = z.object({ tier: z.enum(plans) }).strict();

  return {
    name: "plan-switch-preview",
    description:
      "Previews what switching the existing subscription to another plan tier costs right now (amount due, tax, credit, effective date) plus the target plan's recurring price. Only for providers that switch plans in-app.",
    schema,
    access: { roles: purchaseRolesOf(catalog) },
    handler: async (query, ctx): Promise<PlanSwitchPreviewResult> => {
      // @cast-boundary engine-payload — dispatcher-zod-validated payload
      const { tier } = query.payload as { tier: string };
      const prepared = await preparePlanSwitch(ctx, catalog, tier, "plan-switch-preview");
      const { plugin } = prepared.provider;
      if (!plugin.previewPlanSwitch || !plugin.applyPlanSwitch) {
        throw new UnprocessableError("plan_switch_not_supported", {
          i18nKey: "billing-foundation.errors.planSwitchNotSupported",
          message: `subscription-foundation: provider "${prepared.provider.name}" switches plans on a hosted page and has no in-app preview`,
        });
      }
      const preview = await plugin.previewPlanSwitch(ctx, {
        providerSubscriptionId: prepared.subscription.providerSubscriptionId,
        targetPriceId: prepared.target.priceId,
      });
      const { price } = prepared.target;
      return {
        preview,
        target: {
          tier,
          unitAmount: price.unitAmount ?? 0,
          currency: price.currency,
          interval: price.interval,
          intervalCount: price.intervalCount,
        },
      };
    },
  };
}
