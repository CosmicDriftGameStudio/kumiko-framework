---
"@cosmicdrift/kumiko-renderer": minor
---

`RenderEdit`'s `onChange` now reports a `submitting` flag alongside `values`/`changes`/`dirty`/`valid`, so a host driving its own action bar via `hideActions` can mirror the in-flight submit state.
