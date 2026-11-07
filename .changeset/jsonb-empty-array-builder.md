---
"@cosmicdrift/kumiko-framework": patch
---

`buildEntityTable` honors `emptyValue: "array"` on jsonb fields.

<!-- kumiko-changes
feature: db
type: fix
title: jsonb emptyValue "array" on projection tables
detail: A projection table built with `buildEntityTable` gave a jsonb field with `emptyValue: "array"` the default `{}`, while the entity's migration meta used `[]`. `kumiko-schema generate` then refused the table as declared with diverging columns. Both paths now use `[]`.
-->
