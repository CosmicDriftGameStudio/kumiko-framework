---
"@cosmicdrift/kumiko-framework": patch
---

Forward a reference field's optionsQuery to the client schema

`ReferenceFieldDef.optionsQuery` was dropped by the client-schema projection, so the picker ignored the declared handler and fell back to the entity's list handler. The projection now keeps it.

<!-- kumiko-changes
feature: framework
type: fix
title: A reference field's optionsQuery now reaches the client schema, so the picker uses the declared handler
migration: No code change needed.
-->
