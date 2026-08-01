---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
---

Fix `navigate` rowAction `params` being silently ignored on `entityEdit`-create targets (#1680). `RowActionNavigate.params` was documented as pre-filling both `actionForm` and `entityEdit` create screens, but the renderer's `EntityEditCreateBody` never read `nav.searchParams` — only `ActionFormBody` did. A rowAction like "create contract" navigating from a unit row with `params: { map: { unitId: "id" } }` opened the create form empty instead of pre-filled.

`EntityEditCreateBody` now reads `nav.searchParams` the same way `ActionFormBody` already did (shared `mergeSearchParamsIntoInitial` helper). Fields marked `sensitive` are skipped even when a matching search param exists.

The boot-validator now catches the general case: a `navigate` rowAction with `params` targeting anything other than an `actionForm` or a cross-entity `entityEdit`-create screen throws at boot, since those targets never read URL search params. This includes same-entity `entityEdit` targets and explicit-`entityId` targets — both resolve to update mode, which ignores `params`. `custom` screen targets are exempt: the framework has no visibility into an app-registered component, which may read `nav.searchParams` itself.

This new boot check is stricter than before — a feature whose `entityList` had a `navigate` rowAction with `params` on a same-entity `entityEdit` target (previously silently broken at runtime) will now fail to boot until the `params` extractor is removed or the target is retargeted. `boot-validator-fixture.ts`'s synthetic same-entity edit rowAction (used across dozens of boot-validator tests to stub row-navigation without hand-writing `rowActions`) carried exactly this pattern and needed the same fix; apps with the same pattern in real feature code will need it too on upgrade.
