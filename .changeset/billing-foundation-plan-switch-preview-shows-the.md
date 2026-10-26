---
"@cosmicdrift/kumiko-bundled-features": minor
---

Plan-switch preview shows the recurring price gross

PlanSwitchPreview.recurringAmount and recurringTax carry the provider's gross recurring price; the confirm dialog shows them with the tax when set and falls back to the catalog price otherwise. subscription-paddle fills them from recurring_transaction_details.

<!-- kumiko-changes
feature: billing-foundation
type: improvement
title: Plan-switch preview shows the recurring price gross
-->
