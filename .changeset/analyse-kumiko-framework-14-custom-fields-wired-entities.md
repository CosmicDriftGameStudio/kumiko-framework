---
"@cosmicdrift/kumiko-bundled-features": minor
---

Custom-field definitions and values are accepted only for entities wired with `wireCustomFieldsFor`, and system-tenant field definitions now resolve on value writes.

<!-- kumiko-changes
feature: custom-fields
type: breaking
title: Custom fields only on wired host entities
detail: `define-tenant-field`, `define-system-field`, `set-custom-field` and `clear-custom-field` now fail with 422 `custom_fields_entity_not_wired` when the entity is not wired through `wireCustomFieldsFor`; before, definitions for any name were stored and counted against the quota. Fix: `set-custom-field` and `clear-custom-field` now find system-tenant definitions (the system definition wins over a tenant one with the same key) and ignore deleted definitions, so values for system fields can be written and a deleted field returns 404.
migration: Call `wireCustomFieldsFor` for every entity that should carry custom fields, or remove `createCustomFieldsFeature()` from apps that wire none.
affects: custom-fields, createCustomFieldsFeature, wireCustomFieldsFor, define-tenant-field, define-system-field, set-custom-field, clear-custom-field
-->
