---
"@cosmicdrift/kumiko-framework": minor
---

The generic list handler rejects filters on secret, encrypted and personal fields and ignores sorts on them

<!-- kumiko-changes
feature: framework
type: fix
title: List filters can no longer probe secret, encrypted or personal fields
detail: |
  A `filter`/`filters` entry on a field with `find: "secret"`, `encrypted: true` or a personal-data annotation made hit count and `totalCount` a value oracle (a prefix oracle for legacy plaintext rows before the backfill). The list handler now answers 400 `validation_error` with a field issue `field_not_filterable` (path `filter.<field>`). The one exception is `op: "eq"` with a string on a personal field with `find: "exact"` or `"fuzzy"`, which matches through the blind index. A sort on such a field falls back to id order instead of failing. Unknown fields are still dropped and fields without read access still match nothing; both checks run first.

  The entityList boot validator rejects a screen `filter` the handler would reject.

  Behaviour change: clients that filter on such a field (or send `in`, range or `ne` on a blind-indexed one) now get a 4xx instead of an empty or matching result.
-->
