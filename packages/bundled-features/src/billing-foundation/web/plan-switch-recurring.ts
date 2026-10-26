import type { PlanSwitchPreview } from "../types.ts";

type RecurringSource = {
  readonly preview: PlanSwitchPreview;
  readonly target: { readonly unitAmount: number; readonly currency: string };
};

export type RecurringAmounts = {
  readonly amount: number;
  readonly currency: string;
  readonly tax: number | null;
};

/** The provider's gross recurring price when it reports one, else the catalog's unit amount. */
export function recurringAmountsOf({ preview, target }: RecurringSource): RecurringAmounts {
  return preview.recurringAmount === undefined
    ? { amount: target.unitAmount, currency: target.currency, tax: null }
    : {
        amount: preview.recurringAmount,
        currency: preview.currency,
        tax: preview.recurringTax ?? null,
      };
}
