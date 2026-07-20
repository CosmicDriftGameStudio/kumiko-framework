---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

`relations` and `tree-node` move from `packages/framework/src/engine/types/` to `@cosmicdrift/kumiko-types`. The old paths stay as re-export shims, so no internal import site changes.
