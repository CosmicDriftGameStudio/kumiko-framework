---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

A config key's `validate` function can read the cascade of any registered key through `ctx.readCascade(qualifiedKey)`, for example to check the operator default before accepting a tenant value.

<!-- kumiko-changes
feature: types
type: improvement
title: Config validators can read a key's cascade
detail: ConfigValidateContext gains readCascade(qualifiedKey), which returns the full cascade of any registered key from the writing tenant and user. Unknown keys throw.
-->

<!-- kumiko-changes
feature: config
type: improvement
title: config:write:set passes readCascade to validators
detail: The set handler binds readCascade to the config resolver, the tenant-scoped db and the secrets reader, so validators see the same cascade as the value queries.
-->
