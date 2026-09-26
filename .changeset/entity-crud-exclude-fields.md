---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

Generic create/update entity handlers can exclude individual fields

`defineEntityCreateHandler`/`defineEntityUpdateHandler` accept `excludeFields`, and `registerEntityCrud`/`r.crud` accept `excludeFields: { create?, update? }`. An excluded field stays in the payload schema as "must be absent": a payload that still carries it fails validation (400, path `changes.<field>` on update) instead of being stripped silently. Definition fails loud for an unknown field, for delete/restore, for a totalsMatch field, and on create for a required field without default. `buildInsertSchema`/`buildUpdateSchema` take the exclusion list as an optional third argument.

<!-- kumiko-changes
feature: framework
type: improvement
title: Generic create/update entity handlers can exclude individual fields
detail: |
  `excludeFields` on defineEntityCreateHandler/defineEntityUpdateHandler, and `excludeFields: { create?, update? }` on registerEntityCrud/r.crud. A payload that still carries an excluded field fails validation instead of being stripped silently, so an app no longer needs a hand-written handler just to make one field read-only (e.g. a VIN after creation).
-->
