import type { DashboardCustomPanel, ScreenDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { BILLING_PLANS_PANEL_COMPONENT, BILLING_PLANS_SCREEN_ID } from "./constants";

/** The billing-plans panel, meant to be dropped into an app's own dashboard
 *  screen alongside its own panels — not just the dormant single-panel
 *  screen below. */
export function billingPlansPanel(): DashboardCustomPanel {
  return {
    kind: "custom",
    id: "billing-plans",
    component: { react: { __component: BILLING_PLANS_PANEL_COMPONENT } },
  };
}

/** Dormant dashboard wrapping just the billing-plans panel — apps that
 *  don't compose their own dashboard can nav straight to this screen. */
export function createBillingPlansScreen(viewRoles: readonly string[]): ScreenDefinition {
  return {
    id: BILLING_PLANS_SCREEN_ID,
    type: "dashboard",
    panels: [billingPlansPanel()],
    access: { roles: viewRoles },
    dormant: true,
  };
}
