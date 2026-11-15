---
"@cosmicdrift/kumiko-renderer": patch
---

A required select whose options load from a query no longer keeps its "required" error after the default row is seeded: submitting before the options had loaded showed the error, and the suggestion that filled the field afterwards left it standing.

<!-- kumiko-changes
feature: renderer
type: fix
title: Seeding the default row of a required optionsQuery select clears its required error
detail: Seeding the suggestion (`row.default`) into an empty select now clears that field's issues the same way a typed value does, so a submit before the options query had loaded no longer leaves "required" next to a filled field.
-->
