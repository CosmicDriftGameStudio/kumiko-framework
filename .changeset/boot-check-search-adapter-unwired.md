---
"@cosmicdrift/kumiko-framework": patch
---

`buildServer` now warns at boot when a feature declares an `entityList` screen whose search box would render (`screen.searchable: true`, or unset with a searchable field on the entity) but no `SearchAdapter` is wired on `context.searchAdapter`. Search requests against those entities already fail loud at runtime (`UnprocessableError`, `search_adapter_not_wired`, #2032) — this surfaces the same misconfig at boot instead of on the first search. Non-breaking: a warning, not a boot failure, so apps that haven't wired search yet keep booting. Fix by wiring a `SearchAdapter` (e.g. Meilisearch) on `context.searchAdapter`, or by removing `searchable: true` from the affected fields.
