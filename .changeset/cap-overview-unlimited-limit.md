---
"@cosmicdrift/kumiko-bundled-features": minor
---

`CapSpec.limit` can now return `null` to mark a cap as an unlimited usage meter (counted but never capped), distinct from `limit <= 0` which still means "not part of this tier".
