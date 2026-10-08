---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-dev-server": patch
---

Final review batch F: renderer, renderer-web, types

The boot validator rejects a `listScreenId` that matches no mounted screen, a `sortable` column that the list cannot sort (entityList: any value; projectionList: `true`) and an authored `urlPrefillFields`. `TreeAction` is a union: exactly one of `screen` or `target`. `Button` without children needs `icon` and `ariaLabel`. `RenderEditControls` gains `next` and `back`, and `controls.submit()` saves on an intermediate wizard step. An actionForm money field with a tenant currency that cannot be loaded shows an error instead of submitting with a guessed EUR. The MFA setup and recovery-code buttons sit below the content. The boot context passes Redis to the delivery service, so `notify` with an `idempotencyKey` dedupes. `user:query:user:detail` skips the tenants label when the tenant feature is not mounted.

<!-- kumiko-changes
feature: renderer
type: breaking
title: Grid columns is number | "auto"
migration: Pass a number or "auto" to Grid columns; other values no longer type-check.
-->

<!-- kumiko-changes
feature: renderer
type: breaking
title: Button without children requires icon and ariaLabel
migration: A custom wrapper that forwards ButtonProps must pass either children or both icon and ariaLabel.
-->

<!-- kumiko-changes
feature: renderer
type: fix
title: RenderEditControls has next and back; submit saves on an intermediate wizard step
migration: No action needed. A host that renders its own wizard buttons with hideActions can call controls.next(), controls.back() and controls.submit().
-->

<!-- kumiko-changes
feature: renderer
type: fix
title: actionForm money fields with a tenant currency block the form when the currency cannot be loaded
migration: No action needed. secretMint and the reference create dialog keep their fallback currency.
-->

<!-- kumiko-changes
feature: renderer-web
type: breaking
title: MFA setup and recovery-code buttons moved from Section actions to the section body
migration: Section actions always render in the title row. Put a footer button into the section children instead of Section actions.
-->

<!-- kumiko-changes
feature: framework
type: breaking
title: Boot validator rejects inert sortable, authored urlPrefillFields and an unknown listScreenId
migration: Remove sortable from entityList columns and sortable true from projectionList columns (declare sorting on the entity field), remove urlPrefillFields from form screens (buildAppSchema derives it from navigate params), and point listScreenId at a mounted screen short id.
-->

<!-- kumiko-changes
feature: framework
type: breaking
title: TreeAction is screen XOR target at the type level
migration: Give every createAction and actions[] entry either screen or target, not both and not neither; the boot validator already rejected the other forms.
-->

<!-- kumiko-changes
feature: user
type: fix
title: user:query:user:detail skips the tenants label when the tenant feature is not mounted
-->

<!-- kumiko-changes
feature: server-runtime
type: fix
title: Boot context passes Redis to the delivery service
detail: notify with an idempotencyKey used to throw because the delivery service had no idempotencyRedis. Production boot, dev boot and the worker boot now hand over the existing Redis.
migration: No action needed.
-->

<!-- kumiko-changes
feature: dev-server
type: fix
title: Dev boot passes Redis to the delivery service so notify idempotencyKey dedupes
migration: No action needed.
-->
