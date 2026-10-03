---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Config key definitions accept a new async `validate(value, ctx)` function. `config:write:set` runs it after the type, bounds and pattern checks and before the value is stored, for every scope and backing. A validator rejects the write by throwing a `KumikoError`, for example an `UnprocessableError`. The feature manifest reports `validated` per key.

<!-- kumiko-changes
feature: config
type: improvement
title: config keys can declare an async write validator that rejects with a KumikoError
migration: |
  No action needed: keys without `validate` behave as before.
-->
