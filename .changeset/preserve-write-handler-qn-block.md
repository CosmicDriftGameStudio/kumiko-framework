---
"@cosmicdrift/kumiko-dev-server": patch
---

Fix `runCodegen` (and thus `kumiko-build`) deleting an already-generated `WriteHandlerQn` union / `TypedDispatcher` block from `.kumiko/` when no `feature-manifest.json` is present; the block is now preserved as-is with a warning instead of being silently dropped.
