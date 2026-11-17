---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-renderer": patch
---

An actionForm can reuse an entity's field labels and option labels via `labelEntity`.

<!-- kumiko-changes
feature: screens
type: improvement
title: actionForm labelEntity
detail: `labelEntity` on an actionForm names an entity of the same feature. Every form field that entity also declares takes its label from `<feature>:entity:<labelEntity>:field:<name>` and its select option labels from `...:field:<name>:option:<value>`, both in the renderer and in the required i18n keys. An entry in `fieldLabels` still wins; fields the entity lacks keep the `__action-form__` keys. buildAppSchema derives `labelEntityFields`; a `labelEntity` that is not an entity of the feature fails the boot with `form/label-entity-unknown`. Without `labelEntity` nothing changes.
migration: Optional. Set `labelEntity` on forms whose fields mirror an entity, then delete the `fieldLabels` entries that only point at that entity's field keys and the duplicated `__action-form__` translations.
-->
