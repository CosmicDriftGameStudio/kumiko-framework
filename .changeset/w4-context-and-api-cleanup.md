---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": patch
---

Removes deprecated API: `HandlerContext.outsideTransaction`, `buildEntityTableMeta`, `dsgvoSelfServiceFeatures` with `DsgvoSelfServiceOptions`, and the `observabilityOptions` option of the entrypoint and the prod/worker runners.

<!-- kumiko-changes
feature: types
type: breaking
title: HandlerContext.outsideTransaction removed
detail: The deprecated outsideTransaction field no longer exists on HandlerContext. ctx.dbOutsideTransaction together with runInOwnTransaction replaces it.
migration: Replace ctx.outsideTransaction(fn) with runInOwnTransaction(requireOutsideTransactionDb(ctx), fn); both are exported from @cosmicdrift/kumiko-framework/db and fn keeps its (db) => Promise signature.
-->

<!-- kumiko-changes
feature: framework
type: breaking
title: buildEntityTableMeta and observabilityOptions removed
detail: buildEntityTableMeta was a deprecated alias of deriveEntityTableMeta. The deprecated observabilityOptions option of the entrypoint and the prod and worker runners is gone as well, it had no effect since the HTTP route label no longer carries a query string.
migration: Rename buildEntityTableMeta to deriveEntityTableMeta (same signature). Delete observabilityOptions from the entrypoint and runner options, nothing replaces it.
-->

<!-- kumiko-changes
feature: presets
type: breaking
title: dsgvoSelfServiceFeatures removed
detail: The deprecated preset dsgvoSelfServiceFeatures and its DsgvoSelfServiceOptions type are gone. composeGdprStack covers the same features.
migration: Use composeGdprStack({ selfService: { userDataRights } }), or mount createSessionsFeature, createDataRetentionFeature, createComplianceProfilesFeature, createUserDataRightsFeature and createUserProfileFeature yourself.
-->
