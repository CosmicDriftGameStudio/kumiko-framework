---
"@cosmicdrift/kumiko-guards": patch
---

The direct-entity-writes guard treats r.crud entities like r.entity and resolves table arguments such as tables.userTable.

<!-- kumiko-changes
feature: guards
type: improvement
title: Direct-Entity-Writes Guard covers r.crud tables
detail: An entity registered with `r.crud(name, entityDef, options)` makes the table built from `buildEntityTable(..., entityDef)` an event-sourced table, the same as `r.entity({ name, ...entityDef })`. A write whose table argument is a property access (`tables.userTable`) is resolved through the property's symbol instead of being skipped.
-->
