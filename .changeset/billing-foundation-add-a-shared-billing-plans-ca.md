---
"@cosmicdrift/kumiko-bundled-features": minor
---

Add a shared billing-plans catalog (start-plan-checkout, switch-plan, BillingPlansPanel)

BillingFoundationOptions gains an optional catalog: BillingPlanCatalog<TTier>, describing the app's purchasable tiers, benefits, current-tier resolution and view/purchase roles. Two new write handlers, start-plan-checkout and switch-plan, and a billing-plans query resolve prices via the provider's retrievePrices, decide checkout vs. switch per tier, and enforce viewRoles/purchaseRoles. BillingPlansPanel (web) renders the catalog via the new PlanCard/PlanGrid widgets, handling loading/error/disabled/read-only states and disabling every CTA while a checkout/switch/portal mutation is in flight.

<!-- kumiko-changes
feature: billing-foundation
type: improvement
title: Add a shared billing-plans catalog (start-plan-checkout, switch-plan, BillingPlansPanel)
-->
