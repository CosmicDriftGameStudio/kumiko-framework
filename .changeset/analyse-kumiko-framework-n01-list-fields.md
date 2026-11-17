---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

Entity lists take `fields` to read and return only the named fields.

<!-- kumiko-changes
feature: entity-handlers
type: improvement
title: Entity list queries read only the requested fields
detail: `executor.list` and every `<entity>:list` query accept `fields: string[]`. The SQL reads only `id`, `version` and the named fields (money and located timestamp fields with their companion columns), so long texts and encrypted fields a caller does not need are neither read nor decrypted. Rows carry exactly `id`, `version` and the requested fields; derived fields are not computed. A name that is no stored field fails with a validation error (`unknown_field`). Sorting, cursors, filters and references work as before.
-->
