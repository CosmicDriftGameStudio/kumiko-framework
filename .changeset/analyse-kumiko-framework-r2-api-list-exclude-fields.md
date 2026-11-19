---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

`defineEntityListHandler` takes `excludeFields` for fields the list never reads or returns.

<!-- kumiko-changes
feature: framework
type: improvement
title: Entity lists can leave out long fields
detail: `defineEntityListHandler(name, entity, { access, excludeFields: ["details"] })` reads every column except the excluded fields and their money and located-timestamp companion columns, so long texts that only a detail view shows are neither read nor sent with each row. Derived fields, system columns, sorting, cursors, filters and references work as before, and the detail handler still returns the field. A `fields` selection that names an excluded field fails with a validation error (`unknown_field`), and an excluded name that is no field of the entity fails at definition. This is no access rule; hide confidential data with the field's `access.read`.
-->
