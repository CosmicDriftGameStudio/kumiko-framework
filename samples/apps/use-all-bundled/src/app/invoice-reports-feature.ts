// @runtime dev
//
// Dev-/screenshot-only host for realistic event consumers. The consumers never
// receive an event here; the screenshot seed parks them in the dead/disabled
// states the jobs:event-consumers screen is meant to show.

import { entityEventName } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";

export const INVOICE_TOTALS_CONSUMER = "invoice-totals";
export const OVERDUE_REMINDERS_CONSUMER = "overdue-reminders";
export const CUSTOMER_STATEMENTS_CONSUMER = "customer-statements";

const noop = async (): Promise<void> => {};

export const invoiceReportsFeature: FeatureDefinition = defineFeature("invoice-reports", (r) => {
  r.describe(
    "Dev-only host for the invoice read models whose consumer state the screenshot seed sets.",
  );
  for (const name of [
    INVOICE_TOTALS_CONSUMER,
    OVERDUE_REMINDERS_CONSUMER,
    CUSTOMER_STATEMENTS_CONSUMER,
  ]) {
    r.multiStreamProjection({
      name,
      apply: { [entityEventName("invoice", "created")]: noop },
    });
  }
});
