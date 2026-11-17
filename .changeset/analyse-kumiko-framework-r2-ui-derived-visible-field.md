---
"@cosmicdrift/kumiko-framework": patch
---

Row actions of an entityList may show or hide on a derived field of the entity with `visible: { field, eq }`.

<!-- kumiko-changes
feature: framework
type: improvement
title: Row action visibility reads derived fields
detail: Boot validation used to accept only stored entity fields and row meta columns in `visible.field` of entityList rowActions and expandableRow toolbarActions, although the list handler puts every derived field (`createDerivedField`, JS `derive` and SQL) on each row. A derived field is now a valid `visible.field`, so one derived boolean can combine conditions that a single FieldCondition cannot AND. `payload`/`params` extractors and `entityId` still accept only stored fields and row meta columns, because a derived value is display-only. An unknown name still fails boot with `screen/action-visible-unknown-field`, and the message lists the derived fields among the known ones.
-->
