---
"@cosmicdrift/kumiko-framework": patch
---

`createEntity` accepts inline field literals without `as const`

`createEntity({ fields: { owner: { type: "reference", entity: "user" } } })` no longer collapses to `never`: the `fields` type parameter is `const`, so `type` keeps its literal instead of widening to `string`. Field helpers (`createTextField` and friends) behave as before.

<!-- kumiko-changes
feature: framework
type: fix
title: createEntity no longer collapses to never for inline field literals such as { type: "reference", entity }
detail: The fields type parameter is const, so the literal type of each inline field survives without as const.
-->
