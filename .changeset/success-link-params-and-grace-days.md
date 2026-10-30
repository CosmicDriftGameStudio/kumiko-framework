---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-framework": patch
---

A form success link can open a custom screen with URL params from the result, and apps can read the soft-delete retention period.

<!-- kumiko-changes
feature: renderer
type: improvement
title: successLinks take params read from the success payload
detail: ActionFormSuccessLink gets params, a map from URL search param to success-payload field. `{ screen: "cockpit", params: { cmd: "duplicateOfId" } }` opens the cockpit with `?cmd=<duplicateOfId>`. The link stays hidden while a mapped field is not a string, like a link whose id field is missing.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: Soft-delete retention period is exported
detail: The engine barrel exports SOFT_DELETE_GRACE_DAYS_KEY, SOFT_DELETE_DEFAULT_GRACE_DAYS (30) and readSoftDeleteGraceDays(ctx.config), which returns the tenant's configured period or the default. A trash screen can show how long deleted rows stay restorable without keeping its own constant.
-->
