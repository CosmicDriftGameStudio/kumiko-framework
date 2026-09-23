---
"@cosmicdrift/kumiko-bundled-features": minor
---

billing-foundation no longer exports SystemWriteResult (removed in 0.298.0 without a changelog note)

<!-- kumiko-changes
feature: billing-foundation
type: breaking
title: billing-foundation no longer exports SystemWriteResult (removed in 0.298.0 without a changelog note)
migration: |
  SystemWriteResult was exported from @cosmicdrift/kumiko-bundled-features/billing-foundation up to 0.297.0 and was dropped in 0.298.0 together with the dispatchSystemWrite dep of createSubscriptionTierSync; there is no alias. Code that still imports it fails with "has no exported member 'SystemWriteResult'". If the type is only used for a dispatchSystemWrite dep passed to createSubscriptionTierSync, drop that dep and the type together (see the 0.298.0 webhook-wiring migration: extraRoutes: [createSubscriptionTierSync({ ... }).createWebhookRoute()]). Where a system-write result type is still needed, import type { WriteResult } from "@cosmicdrift/kumiko-framework/engine" and use WriteResult<unknown>; it is a discriminated union ({ isSuccess: true; data } | WriteFailure), so narrow on isSuccess before reading data or error.
-->
