---
"@cosmicdrift/kumiko-bundled-features": minor
---

A number written by a handler can be bounded per tier

`createValueCapGuard(resolveTierCaps)` returns `checkValueCap` and `withValueCap`. The spec names the payload field, optional `min` and `max` functions over the tier caps (`undefined` means unbounded), an error code and an i18n key. The value is read from the payload or, for entity updates, from `changes`; an absent or non-numeric value passes. A value below the minimum or above the maximum is rejected with `UnprocessableError` and `details: { field, value, min, max }`. `withValueCap` spreads the wrapped handler, so it composes with `withCapEnforcement`.

<!-- kumiko-changes
feature: cap-counter
type: improvement
title: createValueCapGuard rejects a written number outside the min and max of the tenant's tier
-->
