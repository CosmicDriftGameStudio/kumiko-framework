---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": minor
---

Handler field references support business keys and array fields

<!-- kumiko-changes
feature: framework
type: breaking
title: Handler field references support business keys and array fields
migration: |
  handlerFieldReference(schema, field) now returns { entity, by, multiple } instead of the entity string. Replace reference with reference.entity; skip or handle fields where by is set (value is a business key, not an id) or multiple is true (value is an array).
-->
