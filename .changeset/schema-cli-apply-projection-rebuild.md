---
"@cosmicdrift/kumiko-framework": minor
---

`runSchemaCli` gains an optional `{ features }` option: when given, `schema apply` rebuilds the projections whose tables a freshly applied migration changed (via its `.rebuild.json` marker) — the projection-rebuild step app `bin/kumiko.ts` files duplicate today. Backward compatible: the dev `kumiko schema` path omits `features` and applies migrations only.
